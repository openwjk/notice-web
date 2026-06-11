const { request } = require("../../utils/request");

const TABS = [
  { key: "all", label: "全部" },
  { key: "text", label: "文本" },
  { key: "flow", label: "工作流" }
];

Page({
  data: {
    connectionText: "未连接",
    connectionClass: "idle",
    loading: false,
    tabs: TABS,
    activeTab: "all",
    activeFilter: "all",
    reminders: [],
    stats: {},
    visibleReminders: [],
    swipeOpenId: "",
    canEditList: true,
    emptyText: "暂无配置项"
  },

  onLoad(options) {
    const tab = options && options.tab ? decodeURIComponent(options.tab) : "all";
    const filter = options && options.filter ? decodeURIComponent(options.filter) : "all";
    this.setData({
      activeTab: this.getValidTab(tab),
      activeFilter: this.getValidFilter(filter),
      canEditList: this.canEditFilter(filter)
    });
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
        const reminders = Array.isArray(dashboard.items) ? dashboard.items : [];
        const stats = dashboard.stats || {};
        this.setData({ reminders, stats, connectionText: "已连接", connectionClass: "online" }, () => this.refreshVisibleReminders());
      },
      fail: () => {
        this.setData({ connectionText: "连接失败", connectionClass: "offline" });
      },
      complete: () => {
        this.setData({ loading: false });
        if (done) {
          done();
        }
      }
    });
  },

  selectTab(event) {
    this.setData({
      activeTab: event.currentTarget.dataset.key,
      swipeOpenId: ""
    }, () => this.refreshVisibleReminders());
  },

  createReminder() {
    this.closeSwipe();
    wx.navigateTo({ url: "/pages/reminders/index" });
  },

  editReminder(event) {
    this.closeSwipe();
    const id = event.currentTarget.dataset.id || "";
    wx.navigateTo({ url: `/pages/reminders/index?id=${encodeURIComponent(id)}` });
  },

  removeReminder(event) {
    this.closeSwipe();
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除提醒",
      content: "删除后会标记为已删除，不会从 JSON 中物理移除。",
      confirmText: "删除",
      confirmColor: "#dc2626",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ loading: true });
        this.request({
          path: `/api/reminders/${id}`,
          method: "DELETE",
          success: (payload) => {
            const dashboard = payload.data.dashboard || {};
            const reminders = Array.isArray(dashboard.items) ? dashboard.items : [];
            this.setData({ reminders, swipeOpenId: "" }, () => this.refreshVisibleReminders());
            wx.showToast({ title: "已逻辑删除", icon: "success" });
          },
          complete: () => {
            this.setData({ loading: false });
          }
        });
      }
    });
  },

  toggleReminder(event) {
    this.closeSwipe();
    const id = event.currentTarget.dataset.id;
    const item = this.data.reminders.find(r => r.id === id);
    const nextEnabled = item ? !item.enabled : true;
    const label = nextEnabled ? "启用" : "停用";
    this.setData({ loading: true });
    this.request({
      path: `/api/reminders/${id}/toggle`,
      method: "PUT",
      success: (payload) => {
        const dashboard = (payload.data.dashboard || {});
        const reminders = Array.isArray(dashboard.items) ? dashboard.items : [];
        this.setData({ reminders, swipeOpenId: "" }, () => this.refreshVisibleReminders());
        wx.showToast({ title: `已${label}`, icon: "success" });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
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
        const message = res.statusCode === 401 ? "Token 无效" : "后端请求失败";
        wx.showToast({ title: message, icon: "none" });
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

  getValidTab(tab) {
    return TABS.some(item => item.key === tab) ? tab : "all";
  },

  getValidFilter(filter) {
    return ["all", "enabled", "matched", "errors"].indexOf(filter) >= 0 ? filter : "all";
  },

  canEditFilter(filter) {
    return this.getValidFilter(filter) === "all";
  },

  touchReminderStart(event) {
    if (!this.data.canEditList) {
      return;
    }
    const touch = event.touches && event.touches[0];
    if (!touch) {
      return;
    }
    this.swipeTouch = {
      id: event.currentTarget.dataset.id || "",
      startX: touch.clientX,
      startY: touch.clientY
    };
  },

  touchReminderMove(event) {
    if (!this.data.canEditList || !this.swipeTouch || !event.touches || !event.touches.length) {
      return;
    }
    const touch = event.touches[0];
    const deltaX = touch.clientX - this.swipeTouch.startX;
    const deltaY = touch.clientY - this.swipeTouch.startY;
    this.swipeTouch.horizontal = Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY);
  },

  touchReminderEnd(event) {
    if (!this.data.canEditList || !this.swipeTouch) {
      return;
    }
    const touch = event.changedTouches && event.changedTouches[0];
    const deltaX = touch ? touch.clientX - this.swipeTouch.startX : 0;
    const deltaY = touch ? touch.clientY - this.swipeTouch.startY : 0;
    const id = this.swipeTouch.id;
    this.swipeTouch = null;
    if (Math.abs(deltaX) <= 40 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    this.lastSwipeAt = Date.now();
    this.setData({
      swipeOpenId: deltaX < 0 ? id : ""
    });
  },

  touchReminderCancel() {
    this.swipeTouch = null;
  },

  closeSwipe(event) {
    if (event && this.lastSwipeAt && Date.now() - this.lastSwipeAt < 250) {
      return;
    }
    if (this.data.swipeOpenId) {
      this.setData({ swipeOpenId: "" });
    }
  },

  refreshVisibleReminders() {
    const activeTab = this.data.activeTab;
    const activeFilter = this.data.activeFilter;
    const statRecords = this.getStatRecords(activeFilter);
    const statMap = this.buildStatMap(statRecords);
    const visibleReminders = this.data.reminders
      .filter(item => activeFilter !== "enabled" || item.enabled)
      .filter(item => activeFilter === "all" || activeFilter === "enabled" || statMap[item.id])
      .filter(item => activeTab === "all" || item.type === activeTab)
      .map(item => Object.assign({}, item, {
        typeInitial: item.type === "flow" ? "流" : "文",
        typeLabel: item.type === "flow" ? "工作流" : "普通文本",
        statusText: item.enabled ? "启用" : "停用",
        statusClass: item.enabled ? "is-on" : "is-off",
        toggleLabel: item.enabled ? "停用" : "启用",
        toggleClass: item.enabled ? "toggle-disable" : "toggle-enable",
        summary: this.getDisplaySummary(item, statMap[item.id]),
        meta: this.getDisplayMeta(item, statMap[item.id])
      }));
    this.setData({
      visibleReminders,
      emptyText: this.getEmptyText(activeFilter)
    });
  },

  getStatRecords(filter) {
    const stats = this.data.stats || {};
    if (filter === "enabled") {
      return [];
    }
    if (filter === "matched") {
      return Array.isArray(stats.todayRecords) ? stats.todayRecords : [];
    }
    if (filter === "errors") {
      return Array.isArray(stats.errorRecords) ? stats.errorRecords : [];
    }
    return [];
  },

  buildStatMap(records) {
    return (records || []).reduce((result, record) => {
      if (record && record.id) {
        result[record.id] = record;
      }
      return result;
    }, {});
  },

  getDisplaySummary(item, record) {
    if (this.data.activeFilter === "errors" && record && record.message) {
      return record.message;
    }
    return this.getSummary(item);
  },

  getDisplayMeta(item, record) {
    const prefix = this.data.activeFilter === "matched" ? "今日命中" : (this.data.activeFilter === "errors" ? "异常" : "");
    const time = record && record.occurredAt ? record.occurredAt.replace("T", " ") : "";
    const base = item.cron || "未设置 Cron";
    if (prefix && time) {
      return `${prefix} · ${time} · ${base}`;
    }
    if (prefix) {
      return `${prefix} · ${base}`;
    }
    return base;
  },

  getEmptyText(filter) {
    if (filter === "enabled") {
      return "暂无已启用配置";
    }
    if (filter === "matched") {
      return "暂无今日命中记录";
    }
    if (filter === "errors") {
      return "暂无异常记录";
    }
    return "暂无配置项";
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
