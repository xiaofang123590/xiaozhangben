/**
 * auth.js —— 小账本 · 本机多账户 + 账本加密模块
 *
 * 暴露全局对象 Auth（普通 <script> 引入，无模块系统）。
 * 账号只存在于本机浏览器：注册的账户之间账本数据完全隔离
 * （数据层由 core.js 按账户名分键存储，见 Store.setUser）。
 *
 * 密码与加密：
 *   - 密码不存明文：PBKDF2-SHA256（15 万次迭代 + 随机盐）派生哈希；
 *     老账户（旧版单次 SHA-256 哈希）在下次登录成功时自动无感升级。
 *   - 账本加密（可选，管理页开启）：用 PBKDF2(password, encSalt) 派生
 *     AES-GCM 密钥，整份账本加密后才写入 localStorage；密钥只留在内存，
 *     每次重新打开应用都需输入密码解锁。忘记密码 = 数据无法恢复（设计如此）。
 *   - 无 Web Crypto 的环境（例如 http 局域网访问）：密码退回旧版简易哈希
 *     （仅隔离不防破解），账本加密不可开启。
 *
 * 存储键：
 *   jz_users    [{ username, salt, hash, iter?, enc?, encSalt?, createdAt }]
 *                 iter 为空 = 旧版单次哈希；enc = 是否开启账本加密
 *   jz_session  当前登录用户名
 *
 * 除 register/login 明确 throw 业务错误外，其余方法静默容错不抛异常。
 */
var Auth = (function () {
  'use strict';

  var USERS_KEY = 'jz_users';
  var SESSION_KEY = 'jz_session';

  /** PBKDF2-SHA256 迭代次数（新注册 / 升级 / 密钥派生统一使用） */
  var PBKDF2_ITERS = 150000;

  /** 用户名：2~20 位中文、字母、数字、下划线 */
  var NAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/;

  // ==================== 内部状态 ====================

  /** AES-GCM 账本密钥与所属账户（仅内存，重新打开应用即失效 → 需要重新解锁） */
  var dataKey = null;
  var dataKeyUser = null;
  /** 换密码时暂存的旧钥匙（写数据失败时回滚用） */
  var prevKey = null;
  /** 登录/解锁时解密出来的账本明文（供 core.js 同步 load 取用；登出时清空） */
  var pendingPlain = null;

  // ==================== 内部工具 ====================

  function readUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.warn('[auth.js] 用户表读取失败，已按空处理：', e);
      return [];
    }
  }

  function writeUsers(list) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('[auth.js] 用户表写入失败：', e);
      return false;
    }
  }

  function findUser(list, username) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].username === username) return list[i];
    }
    return null;
  }

  function randomSalt() {
    var bytes = new Uint8Array(16);
    try {
      crypto.getRandomValues(bytes);
    } catch (e) {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = '';
    for (var j = 0; j < bytes.length; j++) hex += ('0' + bytes[j].toString(16)).slice(-2);
    return hex;
  }

  function bytesToHex(arr) {
    var hex = '';
    for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
    return hex;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToB64(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  function b64ToBytes(str) {
    var bin = atob(String(str));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hasSubtle() {
    return typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.importKey && crypto.subtle.encrypt;
  }

  /** 旧版哈希：SHA-256(salt::password) → 十六进制；无 Web Crypto 时退化为简易混叠（保底可用） */
  function legacyHash(password, salt) {
    var text = salt + '::' + password;
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      var bytes = new TextEncoder().encode(text);
      return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
        return bytesToHex(new Uint8Array(buf));
      });
    }
    console.warn('[auth.js] 当前环境无 Web Crypto，密码使用简易哈希（建议通过 http(s) 访问）');
    return Promise.resolve((function () {
      var h = 5381;
      for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
      return 'djb2_' + h.toString(16);
    })());
  }

  /** PBKDF2-SHA256 → 32 字节；环境不支持时返回 null */
  function pbkdf2Bits(password, saltHex, iters) {
    if (!hasSubtle() || !crypto.subtle.deriveBits) return Promise.resolve(null);
    var pwBytes = new TextEncoder().encode(String(password));
    var salt = hexToBytes(saltHex);
    return crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits'])
      .then(function (k) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: salt, iterations: iters, hash: 'SHA-256' }, k, 256);
      })
      .then(function (buf) { return new Uint8Array(buf); });
  }

  /** 新密码入库哈希：优先 PBKDF2；环境不支持时退回旧版（iter 不写） */
  function hashForStore(password, salt) {
    return pbkdf2Bits(password, salt, PBKDF2_ITERS).then(function (bits) {
      if (bits) return { hash: bytesToHex(bits), iter: PBKDF2_ITERS };
      return legacyHash(password, salt).then(function (hex) { return { hash: hex, iter: 0 }; });
    });
  }

  /**
   * 校验密码：按用户记录里的格式（新 PBKDF2 / 老单次哈希）比对
   * @returns {Promise<{ok:boolean, legacy:boolean}>} legacy=true 表示需要升级为 PBKDF2
   */
  function verifyUser(user, password) {
    if (user.iter) {
      return pbkdf2Bits(password, user.salt, user.iter).then(function (bits) {
        return { ok: !!bits && bytesToHex(bits) === user.hash, legacy: false };
      });
    }
    return legacyHash(password, user.salt).then(function (hex) {
      return { ok: hex === user.hash, legacy: true };
    });
  }

  /** 派生并装载账本密钥（AES-GCM，密钥只留内存） */
  function deriveDataKey(user, password) {
    if (!hasSubtle()) return Promise.reject(new Error('当前环境不支持加密，请通过 https 打开'));
    return pbkdf2Bits(password, user.encSalt, PBKDF2_ITERS).then(function (bits) {
      if (!bits) throw new Error('当前环境不支持加密，请通过 https 打开');
      return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }).then(function (key) {
      dataKey = key;
      dataKeyUser = user.username;
    });
  }

  /**
   * 登录/解锁成功后：若该账户数据是加密的，先解密出来暂存，
   * 供 core.js 同步 load() 直接取用。
   * @returns {Promise} 解密失败时 reject（数据不可读要显式报错，不能静默清空）
   */
  function cachePlainIfEncrypted(user) {
    var raw = null;
    try { raw = localStorage.getItem('jz_data_v1::' + user.username); } catch (e) { return Promise.resolve(); }
    if (!raw) return Promise.resolve();
    var env = null;
    try { env = JSON.parse(raw); } catch (e) { return Promise.resolve(); }   // 明文：无需处理
    if (!env || env.jzEnc !== 1) return Promise.resolve();
    var iv = b64ToBytes(env.iv);
    var ct = b64ToBytes(env.ct);
    var aad = new TextEncoder().encode(user.username);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: aad }, dataKey, ct)
      .then(function (buf) {
        pendingPlain = new TextDecoder().decode(buf);
      })
      .catch(function () {
        throw new Error('数据解密失败，无法打开账本（密码或数据异常）');
      });
  }

  function setSession(username) {
    try { localStorage.setItem(SESSION_KEY, username); } catch (e) { /* 忽略 */ }
  }

  // ==================== 对外 API ====================

  /**
   * 注册新账户。成功后自动登录。
   * @param {string} username
   * @param {string} password 至少 4 位
   * @returns {Promise<{username:string}>} 失败 throw Error（中文提示）
   */
  function register(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!NAME_RE.test(username)) {
      return Promise.reject(new Error('用户名需为 2~20 位中文/字母/数字/下划线'));
    }
    if (password.length < 4) {
      return Promise.reject(new Error('密码至少 4 位'));
    }
    var users = readUsers();
    if (findUser(users, username)) {
      return Promise.reject(new Error('用户名已存在'));
    }
    var salt = randomSalt();
    return hashForStore(password, salt).then(function (h) {
      var rec = { username: username, salt: salt, hash: h.hash, createdAt: Date.now() };
      if (h.iter) rec.iter = h.iter;
      users.push(rec);
      if (!writeUsers(users)) throw new Error('注册失败：本机存储不可用');
      setSession(username);
      return { username: username };
    });
  }

  /**
   * 登录（同时用于「解锁」：加密账户登录成功即完成解锁）。
   * 老格式密码哈希在此处自动升级为 PBKDF2；加密账户在此处派生账本密钥。
   * @returns {Promise<{username:string}>} 失败 throw Error（中文提示）
   */
  function login(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    var users = readUsers();
    var user = findUser(users, username);
    if (!user) return Promise.reject(new Error('用户不存在'));
    return verifyUser(user, password).then(function (res) {
      if (!res.ok) throw new Error('密码错误');
      // 老哈希透明升级：密码不变，仅改存储格式
      if (res.legacy) {
        return pbkdf2Bits(password, user.salt, PBKDF2_ITERS).then(function (bits) {
          if (bits) {
            user.hash = bytesToHex(bits);
            user.iter = PBKDF2_ITERS;
            writeUsers(users);
          }
          return user;
        });
      }
      return user;
    }).then(function (u) {
      if (u.enc && u.encSalt) {
        return deriveDataKey(u, password).then(function () { return cachePlainIfEncrypted(u); }).then(function () { return u; });
      }
      return u;
    }).then(function (u) {
      setSession(u.username);
      return { username: u.username };
    });
  }

  /** 退出登录：清除会话与内存中的一切密钥/明文，不影响任何账本数据 */
  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
    dataKey = null;
    dataKeyUser = null;
    prevKey = null;
    pendingPlain = null;
  }

  /**
   * 当前登录用户名；未登录或账户已被删除时返回 null
   * @returns {string|null}
   */
  function currentUser() {
    var name = null;
    try { name = localStorage.getItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
    if (!name) return null;
    return findUser(readUsers(), name) ? name : null;
  }

  /** 本机已注册的所有用户名 */
  function users() {
    return readUsers().map(function (u) { return u.username; });
  }

  /** 是否还没有任何账户（用于「首次使用引导注册」提示） */
  function isEmpty() {
    return readUsers().length === 0;
  }

  /** 校验当前账户密码（不改变任何状态） */
  function verifyPassword(password) {
    var name = currentUser();
    if (!name) return Promise.reject(new Error('尚未登录'));
    var user = findUser(readUsers(), name);
    if (!user) return Promise.reject(new Error('账户数据异常'));
    return verifyUser(user, password).then(function (r) { return r.ok; });
  }

  /** 写入新密码（调用前应先用 verifyPassword 校验旧密码；不动账本数据） */
  function replacePassword(newPassword) {
    var name = currentUser();
    if (!name) return Promise.reject(new Error('尚未登录'));
    if (String(newPassword || '').length < 4) {
      return Promise.reject(new Error('新密码至少 4 位'));
    }
    var users = readUsers();
    var user = findUser(users, name);
    if (!user) return Promise.reject(new Error('账户数据异常'));
    var salt = randomSalt();
    return hashForStore(String(newPassword), salt).then(function (h) {
      user.salt = salt;
      user.hash = h.hash;
      if (h.iter) user.iter = h.iter; else delete user.iter;
      if (!writeUsers(users)) throw new Error('修改失败：本机存储不可用');
      return true;
    });
  }

  /** 某账户是否开启了账本加密（缺省 = 当前账户） */
  function isEncEnabled(username) {
    var name = username || currentUser();
    var u = name ? findUser(readUsers(), name) : null;
    return !!(u && u.enc);
  }

  /** 加密账户是否处于「未解锁」（未派生密钥）状态 */
  function isLocked(username) {
    var name = username || currentUser();
    return isEncEnabled(name) && !(dataKey && dataKeyUser === name);
  }

  /**
   * 开启账本加密：校验密码 → 生成/复用加密盐 → 派生密钥 → 标记账户。
   * 之后由 core.js 的 repersist() 把数据加密落盘。
   * @returns {Promise<true>}
   */
  function enableEncryption(password) {
    var name = currentUser();
    if (!name) return Promise.reject(new Error('尚未登录'));
    if (!hasSubtle()) return Promise.reject(new Error('当前环境不支持加密，请通过 https 打开'));
    var users = readUsers();
    var user = findUser(users, name);
    if (!user) return Promise.reject(new Error('账户数据异常'));
    if (user.enc) return Promise.resolve(true);
    return verifyUser(user, String(password || '')).then(function (r) {
      if (!r.ok) throw new Error('密码不正确');
      // 复用已有盐：即使之前关闭过加密，重新开启也能解开旧密文（容错）
      if (!user.encSalt) user.encSalt = randomSalt();
      return deriveDataKey(user, String(password || '')).then(function () {
        user.enc = true;
        if (!writeUsers(users)) {
          user.enc = false;
          dataKey = null; dataKeyUser = null;
          throw new Error('开启失败：本机存储不可用');
        }
        return true;
      });
    });
  }

  /**
   * 关闭账本加密：校验密码 → 清除加密标记与密钥。
   * 之后由 core.js 的 repersist() 把数据以明文写回。
   * 注意：encSalt 保留（万一明文回写失败，重新开启同密码仍能解开旧密文）。
   * @returns {Promise<true>}
   */
  function disableEncryption(password) {
    var name = currentUser();
    if (!name) return Promise.reject(new Error('尚未登录'));
    var users = readUsers();
    var user = findUser(users, name);
    if (!user) return Promise.reject(new Error('账户数据异常'));
    if (!user.enc) return Promise.resolve(true);
    return verifyUser(user, String(password || '')).then(function (r) {
      if (!r.ok) throw new Error('密码不正确');
      user.enc = false;
      if (!writeUsers(users)) throw new Error('关闭失败：本机存储不可用');
      dataKey = null;
      dataKeyUser = null;
      pendingPlain = null;
      return true;
    });
  }

  /**
   * 修改密码时更换账本密钥（加密账户专用）：
   * 用新密码派生新钥匙并装载，旧钥匙暂存以便失败回滚。
   * @returns {Promise<boolean>} 是否确实更换了钥匙（未加密账户返回 false）
   */
  function rekeyData(newPassword) {
    var name = currentUser();
    if (!name) return Promise.resolve(false);
    var user = findUser(readUsers(), name);
    if (!user || !user.enc || !user.encSalt || !dataKey) return Promise.resolve(false);
    prevKey = dataKey;
    return deriveDataKey(user, String(newPassword || '')).then(function () { return true; });
  }

  /** 回滚到 rekeyData 之前的旧钥匙（配合 core 的 repersist 使用） */
  function restoreDataKey() {
    if (!prevKey) return false;
    dataKey = prevKey;
    prevKey = null;
    dataKeyUser = currentUser();
    return true;
  }

  /**
   * 存储编码钩子（core.js persist 调用）：
   * 返回 null 表示不加密（明文写入）；否则返回 Promise<密文信封字符串>。
   */
  function encryptFor(plain) {
    var name = currentUser();
    if (!name || !dataKey || dataKeyUser !== name) return null;
    var user = findUser(readUsers(), name);
    if (!user || !user.enc || !hasSubtle()) return null;
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = new TextEncoder().encode(String(plain));
    var aad = new TextEncoder().encode(name);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad }, dataKey, data)
      .then(function (ct) {
        return JSON.stringify({
          jzEnc: 1,
          iv: bytesToB64(iv),
          ct: bytesToB64(new Uint8Array(ct))
        });
      });
  }

  /** 登录/解锁时已解密的账本明文（供 core.js load 取用；不消费，登出时清空） */
  function peekPendingPlain() {
    return pendingPlain;
  }

  return {
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    users: users,
    isEmpty: isEmpty,
    verifyPassword: verifyPassword,
    replacePassword: replacePassword,
    isEncEnabled: isEncEnabled,
    isLocked: isLocked,
    enableEncryption: enableEncryption,
    disableEncryption: disableEncryption,
    rekeyData: rekeyData,
    restoreDataKey: restoreDataKey,
    encryptFor: encryptFor,
    peekPendingPlain: peekPendingPlain
  };
})();
