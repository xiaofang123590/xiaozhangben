/**
 * auth.js —— 小账本 · 本机多账户模块
 *
 * 暴露全局对象 Auth（普通 <script> 引入，无模块系统）。
 * 账号只存在于本机浏览器：注册的账户之间账本数据完全隔离
 * （数据层由 core.js 按账户名分键存储，见 Store.setUser）。
 *
 * 安全说明：密码不存明文，存储「随机盐 + SHA-256 哈希」。
 * 这是本机级账户隔离（防误看/误记），不等于云端账号安全强度。
 *
 * 存储键：
 *   jz_users    [{ username, salt, hash, createdAt }]
 *   jz_session  当前登录用户名
 *
 * 所有方法异步（内部使用 Web Crypto），除 register/login 明确 throw
 * 业务错误外，其余方法静默容错不抛异常。
 */
var Auth = (function () {
  'use strict';

  var USERS_KEY = 'jz_users';
  var SESSION_KEY = 'jz_session';

  /** 用户名：2~20 位中文、字母、数字、下划线 */
  var NAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/;

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

  /** SHA-256(salt::password) → 十六进制；无 Web Crypto 时退化为简易混叠（保底可用） */
  function hashPassword(password, salt) {
    var text = salt + '::' + password;
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      var bytes = new TextEncoder().encode(text);
      return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
        var arr = new Uint8Array(buf);
        var hex = '';
        for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
        return hex;
      });
    }
    console.warn('[auth.js] 当前环境无 Web Crypto，密码使用简易哈希（建议通过 http(s) 访问）');
    return Promise.resolve((function () {
      var h = 5381;
      for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
      return 'djb2_' + h.toString(16);
    })());
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
    return hashPassword(password, salt).then(function (hash) {
      users.push({ username: username, salt: salt, hash: hash, createdAt: Date.now() });
      if (!writeUsers(users)) throw new Error('注册失败：本机存储不可用');
      try { localStorage.setItem(SESSION_KEY, username); } catch (e) { /* 忽略 */ }
      return { username: username };
    });
  }

  /**
   * 登录。成功后写入会话。
   * @returns {Promise<{username:string}>} 失败 throw Error（中文提示）
   */
  function login(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    var user = findUser(readUsers(), username);
    if (!user) return Promise.reject(new Error('用户不存在'));
    return hashPassword(password, user.salt).then(function (hash) {
      if (hash !== user.hash) throw new Error('密码错误');
      try { localStorage.setItem(SESSION_KEY, username); } catch (e) { /* 忽略 */ }
      return { username: username };
    });
  }

  /** 退出登录：清除会话，不影响任何账本数据 */
  function logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
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

  /**
   * 修改当前登录用户的密码。
   * @returns {Promise<boolean>} 旧密码错误 throw Error('旧密码不正确')
   */
  function changePassword(oldPassword, newPassword) {
    var name = currentUser();
    if (!name) return Promise.reject(new Error('尚未登录'));
    if (String(newPassword || '').length < 4) {
      return Promise.reject(new Error('新密码至少 4 位'));
    }
    var users2 = readUsers();
    var user = findUser(users2, name);
    if (!user) return Promise.reject(new Error('账户数据异常'));
    return hashPassword(String(oldPassword || ''), user.salt).then(function (hash) {
      if (hash !== user.hash) throw new Error('旧密码不正确');
      var salt = randomSalt();
      return hashPassword(String(newPassword), salt).then(function (newHash) {
        user.salt = salt;
        user.hash = newHash;
        if (!writeUsers(users2)) throw new Error('修改失败：本机存储不可用');
        return true;
      });
    });
  }

  return {
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    users: users,
    isEmpty: isEmpty,
    changePassword: changePassword
  };
})();
