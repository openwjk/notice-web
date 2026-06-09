const { request } = require("../../utils/request");

Page({
  data: {
    connectionText: "未连接",
    connectionClass: "idle",
    loading: false,
    totalCount: 0,
    statCards: [],
    typeCards: [],
    recentReminders: []
  },

  onShow() {
    this.fetchDashboard();
  },

  onPullDownRefresh() {
    this.fetchDashboard(() => wx.stopPullDownRefresh());
  },

  fetchDashboard(done) {
    this.setData({ loading: true, connectionText: "连接中", connectionClass: "loading" });
    this.request({
      path: "/api/reminders",
      method: "GET",
      success: (payload) => {
        const dashboard = payload.data || {};
        this.applyDashboard(dashboard);
        this.setData({
          connectionText: "已连接",
          connectionClass: "online"
        });
      },
      fail: () => {
        this.setData({
          connectionText: "连接失败",
          connectionClass: "offline"
        });
      },
      complete: () => {
        this.setData({ loading: false });
        if (done) {
          done();
        }
      }
    });
  },

  applyDashboard(dashboard) {
    const reminders = Array.isArray(dashboard.items) ? dashboard.items : [];
    const stats = Object.assign({ enabled: 0, todayMatched: 0, errors: 0 }, dashboard.stats || {});
    const textCount = reminders.filter(item => item.type !== "flow").length;
    const flowCount = reminders.filter(item => item.type === "flow").length;
    const disabledCount = Math.max(reminders.length - stats.enabled, 0);
    const recentReminders = reminders.slice(0, 4).map(item => ({
      id: item.id,
      title: item.title || "未命名提醒",
      typeLabel: item.type === "flow" ? "工作流" : "普通文本",
      statusText: item.enabled ? "启用" : "停用",
      summary: this.getSummary(item)
    }));

    this.setData({
      totalCount: reminders.length,
      statCards: [
        { label: "已启用", value: stats.enabled, desc: `${disabledCount} 项停用`, tone: "blue", tab: "all", filter: "enabled" },
        { label: "今日命中", value: stats.todayMatched, desc: "查看命中记录", tone: "blue", tab: "all", filter: "matched" },
        { label: "异常", value: stats.errors, desc: stats.errors ? "查看异常记录" : "当前无异常", tone: "amber", tab: "all", filter: "errors" }
      ],
      typeCards: [
        { label: "普通文本", value: textCount, desc: "文本字段提醒", tone: "soft-blue", tab: "text", filter: "all" },
        { label: "工作流", value: flowCount, desc: "执行编码填充数据", tone: "pale-blue", tab: "flow", filter: "all" }
      ],
      recentReminders
    });
  },

  navigateToList(event) {
    const tab = event && event.currentTarget.dataset.tab ? event.currentTarget.dataset.tab : "all";
    const filter = event && event.currentTarget.dataset.filter ? event.currentTarget.dataset.filter : "all";
    wx.navigateTo({ url: `/pages/reminders/list?tab=${encodeURIComponent(tab)}&filter=${encodeURIComponent(filter)}` });
  },

  navigateToLogs() {
    wx.navigateTo({ url: "/pages/reminders/logs" });
  },

  request(options) {
    request({
      path: options.path,
      method: options.method,
      data: options.data,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.success !== false) {
          if (options.success) {
            options.success(res.data);
          }
          return;
        }
        wx.showToast({ title: "后端请求失败", icon: "none" });
        if (options.fail) {
          options.fail(res);
        }
      },
      fail: (error) => {
        wx.showToast({ title: "无法连接后端", icon: "none" });
        if (options.fail) {
          options.fail(error);
        }
      },
      complete: options.complete
    });
  },

  getSummary(item) {
    if (item.type === "flow") {
      return item.exeCode || "未选择执行编码";
    }
    const fields = Array.isArray(item.fields) ? item.fields : [];
    const first = fields[0] || {};
    return first.value || item.data || "未填写提醒内容";
  }
});
