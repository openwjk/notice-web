const BASE_URL = "https://notice-3miz.onrender.com";
const WX_ID_STORAGE_KEY = "noticeWxId";

let pendingWxIdCallbacks = [];
let resolvingWxId = false;

function request(options) {
  requestWithWxId(options, false);
}

function requestWithWxId(options, retried) {
  ensureWxId((wxid) => {
    if (!wxid) {
      const error = { message: "missing wxid" };
      wx.showToast({ title: "无法获取微信身份", icon: "none" });
      if (options.fail) {
        options.fail(error);
      }
      if (options.complete) {
        options.complete(error);
      }
      return;
    }

    let skipComplete = false;
    wx.request({
      url: BASE_URL + options.path,
      method: options.method || "GET",
      data: options.data,
      header: Object.assign({
        "Content-Type": "application/json",
        "wxid": wxid,
        "X-Wx-Id": wxid
      }, options.header || {}),
      success: (res) => {
        if (isEmptyObject(res.data) && !retried) {
          skipComplete = true;
          clearWxId();
          requestWithWxId(options, true);
          return;
        }
        if (options.success) {
          options.success(res);
        }
      },
      fail: options.fail,
      complete: (res) => {
        if (!skipComplete && options.complete) {
          options.complete(res);
        }
      }
    });
  });
}

function ensureWxId(callback) {
  const cachedWxId = getCachedWxId();
  if (cachedWxId) {
    callback(cachedWxId);
    return;
  }

  pendingWxIdCallbacks.push(callback);
  if (resolvingWxId) {
    return;
  }

  resolvingWxId = true;
  wx.login({
    success: (loginRes) => {
      if (!loginRes.code) {
        finishWxId("");
        return;
      }
      wx.request({
        url: `${BASE_URL}/?code=${encodeURIComponent(loginRes.code)}`,
        method: "GET",
        success: (res) => {
          const payload = res.data || {};
          const data = payload.data || {};
          const wxid = data.wxid || data.openid || payload.wxid || payload.openid || "";
          if (wxid) {
            wx.setStorageSync(WX_ID_STORAGE_KEY, wxid);
          }
          finishWxId(wxid);
        },
        fail: () => finishWxId("")
      });
    },
    fail: () => finishWxId("")
  });
}

function getCachedWxId() {
  return wx.getStorageSync(WX_ID_STORAGE_KEY) || wx.getStorageSync("wxid") || wx.getStorageSync("openid") || "";
}

function clearWxId() {
  wx.removeStorageSync(WX_ID_STORAGE_KEY);
}

function isEmptyObject(value) {
  return value && Object.prototype.toString.call(value) === "[object Object]" && !Object.keys(value).length;
}

function finishWxId(wxid) {
  resolvingWxId = false;
  const callbacks = pendingWxIdCallbacks;
  pendingWxIdCallbacks = [];
  callbacks.forEach(callback => callback(wxid));
}

module.exports = {
  request,
  ensureWxId
};
