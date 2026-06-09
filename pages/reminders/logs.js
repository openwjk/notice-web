const { request } = require("../../utils/request");

const LEVELS = [
  { key: "ALL", label: "全部" },
  { key: "INFO", label: "信息" },
  { key: "WARN", label: "警告" },
  { key: "ERROR", label: "错误" },
  { key: "DEBUG", label: "调试" }
];

const LOG_PAGE_SIZE = 120;
const LIVE_MAX_LOG_ROWS = 320;
const RANGE_MAX_LOG_ROWS = 5000;
const RANGE_AUTO_PAGE_LIMIT = 50;

Page({
  data: {
    levels: LEVELS,
    activeLevel: "ALL",
    logs: [],
    cursor: 0,
    live: true,
    loading: false,
    loadingPrevious: false,
    hasMoreBefore: true,
    readingHistory: false,
    statusText: "实时刷新中",
    bottomAnchor: "",
    terminalScrollTop: 0,
    emptyText: "暂无日志",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    startDateTimeText: "",
    endDateTimeText: "",
    startDateTimeRange: [[], [], [], [], []],
    endDateTimeRange: [[], [], [], [], []],
    startDateTimeIndex: [0, 0, 0, 0, 0],
    endDateTimeIndex: [0, 0, 0, 0, 0],
    dateStart: "2020-01-01",
    dateEnd: "2099-12-31"
  },

  onLoad() {
    this.initDateRange();
    this.fetchLogs(true);
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  onPullDownRefresh() {
    this.fetchLogs(true, () => wx.stopPullDownRefresh());
  },

  selectLevel(event) {
    const level = event.currentTarget.dataset.level || "ALL";
    this.setData({
      activeLevel: this.getValidLevel(level),
      cursor: 0,
      logs: [],
      hasMoreBefore: true,
      readingHistory: false
    }, () => this.fetchLogs(true));
  },

  toggleLive() {
    if (!this.data.live && this.hasEndTimeFilter()) {
      this.stopPolling();
      this.setData({
        live: false,
        statusText: "已暂停"
      });
      wx.showToast({ title: "结束时间筛选下不支持实时刷新", icon: "none" });
      return;
    }
    const live = !this.data.live;
    this.setData({
      live,
      statusText: live ? "实时刷新中" : "已暂停"
    }, () => {
      if (live) {
        this.startPolling();
        this.fetchLogs(false);
        return;
      }
      this.stopPolling();
    });
  },

  refreshNow() {
    this.fetchLogs(this.hasTimeFilter() || this.data.readingHistory);
  },

  clearLocal() {
    this.setData({
      logs: [],
      hasMoreBefore: true,
      loadingPrevious: false,
      readingHistory: false,
      emptyText: "已清屏，等待新日志"
    });
  },

  prepareStartDateTimePicker() {
    this.prepareDateTimePicker("start");
  },

  prepareEndDateTimePicker() {
    this.prepareDateTimePicker("end");
  },

  onStartDateTimeColumnChange(event) {
    this.updateDateTimeColumn("start", event.detail.column, event.detail.value);
  },

  onEndDateTimeColumnChange(event) {
    this.updateDateTimeColumn("end", event.detail.column, event.detail.value);
  },

  onStartDateTimeChange(event) {
    this.commitDateTimeFilter("start", event.detail.value);
  },

  onEndDateTimeChange(event) {
    this.commitDateTimeFilter("end", event.detail.value);
  },

  clearTimeFilter() {
    this.setData({
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
      startDateTimeText: "",
      endDateTimeText: "",
      cursor: 0,
      logs: [],
      hasMoreBefore: true,
      readingHistory: false
    }, () => this.fetchLogs(true));
  },

  prepareDateTimePicker(target) {
    const date = target === "start" ? this.data.startDate : this.data.endDate;
    const time = target === "start" ? this.data.startTime : this.data.endTime;
    const current = this.parseLocalDateTime(date, time) || new Date();
    const range = this.buildDateTimeRange(current.getFullYear(), current.getMonth() + 1);
    const index = this.getDateTimeIndex(current, range);
    const next = {};
    if (target === "start") {
      next.startDateTimeRange = range;
      next.startDateTimeIndex = index;
    } else {
      next.endDateTimeRange = range;
      next.endDateTimeIndex = index;
    }
    this.setData(next);
  },

  updateDateTimeColumn(target, column, value) {
    const indexKey = target === "start" ? "startDateTimeIndex" : "endDateTimeIndex";
    const rangeKey = target === "start" ? "startDateTimeRange" : "endDateTimeRange";
    const index = this.data[indexKey].slice();
    index[column] = value;
    let range = this.data[rangeKey];
    if (column === 0 || column === 1) {
      const year = Number(range[0][index[0]]);
      const month = Number(range[1][index[1]]);
      range = this.buildDateTimeRange(year, month);
      index[2] = Math.min(index[2], range[2].length - 1);
    }
    const next = {};
    next[rangeKey] = range;
    next[indexKey] = index;
    this.setData(next);
  },

  commitDateTimeFilter(target, index) {
    const range = target === "start" ? this.data.startDateTimeRange : this.data.endDateTimeRange;
    const selected = this.getDateTimeByIndex(index, range);
    const next = {
      cursor: 0,
      logs: [],
      hasMoreBefore: true,
      readingHistory: false
    };
    if (target === "start") {
      next.startDate = selected.date;
      next.startTime = selected.time;
      next.startDateTimeText = selected.text;
      next.startDateTimeIndex = index;
    } else {
      this.stopPolling();
      next.endDate = selected.date;
      next.endTime = selected.time;
      next.endDateTimeText = selected.text;
      next.endDateTimeIndex = index;
      next.live = false;
      next.statusText = "已暂停";
    }
    this.setData(next, () => this.fetchLogs(true));
  },

  startPolling() {
    this.stopPolling();
    if (!this.data.live) {
      return;
    }
    if (this.hasEndTimeFilter()) {
      this.setData({
        live: false,
        statusText: "已暂停"
      });
      return;
    }
    this.timer = setInterval(() => {
      this.fetchLogs(false);
    }, 2000);
  },

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  hasEndTimeFilter() {
    return Boolean(this.data.endDate);
  },

  hasTimeFilter() {
    return Boolean(this.data.startDate || this.data.endDate);
  },

  getMaxLogRows() {
    return this.hasTimeFilter() || this.data.readingHistory ? RANGE_MAX_LOG_ROWS : LIVE_MAX_LOG_ROWS;
  },

  fetchLogs(reset, done) {
    if (this.data.loading) {
      if (done) {
        done();
      }
      return;
    }
    const seq = (this.logFetchSeq || 0) + 1;
    this.logFetchSeq = seq;
    const nextState = { loading: true };
    if (reset) {
      nextState.hasMoreBefore = true;
      nextState.readingHistory = false;
    }
    this.setData(nextState);
    this.fetchLogPage({
      after: reset ? 0 : this.data.cursor,
      done,
      page: 0,
      reset,
      seq
    });
  },

  fetchLogPage(options) {
    const after = options.after || 0;
    const reset = options.reset;
    const done = options.done;
    const query = [
      `after=${after}`,
      `limit=${LOG_PAGE_SIZE}`
    ];
    if (this.data.activeLevel !== "ALL") {
      query.push(`level=${encodeURIComponent(this.data.activeLevel)}`);
    }
    const start = this.buildDateTime(this.data.startDate, this.data.startTime, "00:00");
    const end = this.buildDateTime(this.data.endDate, this.data.endTime, "23:59");
    if (start) {
      query.push(`start=${encodeURIComponent(start)}`);
    }
    if (end) {
      query.push(`end=${encodeURIComponent(end)}`);
    }
    this.request({
      path: `/api/system/logs?${query.join("&")}`,
      success: (payload) => {
        if (options.seq !== this.logFetchSeq) {
          return;
        }
        const data = payload.data || {};
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const displayEntries = this.toNewestFirst(entries);
        const logs = reset && options.page === 0 ? displayEntries : this.mergeLogEntries(displayEntries, this.data.logs);
        const maxRows = this.getMaxLogRows();
        const nextLogs = logs.slice(0, maxRows).map(item => this.toLogItem(item));
        const cursor = data.cursor || this.data.cursor;
        this.setData({
          logs: nextLogs,
          cursor,
          emptyText: this.getEmptyText(),
          bottomAnchor: ""
        }, () => {
          if (this.shouldContinueRangeFetch(entries, after, cursor, options.page)) {
            this.fetchLogPage({
              after: cursor,
              done,
              page: options.page + 1,
              reset: false,
              seq: options.seq
            });
            return;
          }
          this.finishLogFetch(done);
        });
      },
      fail: () => {
        this.setData({ statusText: "连接失败" });
        this.finishLogFetch(done);
      }
    });
  },

  loadPreviousLogs() {
    if (this.data.loading || this.data.loadingPrevious || !this.data.hasMoreBefore || !this.data.logs.length) {
      return;
    }
    const before = this.getOldestLogSequence();
    if (!before) {
      return;
    }
    const query = [
      `before=${before}`,
      `limit=${LOG_PAGE_SIZE}`
    ];
    if (this.data.activeLevel !== "ALL") {
      query.push(`level=${encodeURIComponent(this.data.activeLevel)}`);
    }
    const start = this.buildDateTime(this.data.startDate, this.data.startTime, "00:00");
    const end = this.buildDateTime(this.data.endDate, this.data.endTime, "23:59");
    if (start) {
      query.push(`start=${encodeURIComponent(start)}`);
    }
    if (end) {
      query.push(`end=${encodeURIComponent(end)}`);
    }
    this.setData({
      loadingPrevious: true,
      readingHistory: true,
      bottomAnchor: ""
    });
    this.request({
      path: `/api/system/logs?${query.join("&")}`,
      success: (payload) => {
        const data = payload.data || {};
        const entries = Array.isArray(data.entries) ? data.entries : [];
        if (!entries.length) {
          this.setData({
            loadingPrevious: false,
            hasMoreBefore: false
          });
          return;
        }
        const logs = this.mergeLogEntries(this.data.logs, this.toNewestFirst(entries));
        const nextLogs = logs.slice(0, this.getMaxLogRows()).map(item => this.toLogItem(item));
        this.setData({
          logs: nextLogs,
          loadingPrevious: false,
          hasMoreBefore: entries.length >= LOG_PAGE_SIZE,
          emptyText: this.getEmptyText(),
          bottomAnchor: ""
        });
      },
      fail: () => {
        this.setData({ loadingPrevious: false });
      }
    });
  },

  getOldestLogSequence() {
    const last = this.data.logs[this.data.logs.length - 1];
    const sequence = last ? Number(last.sequence) : 0;
    return isFinite(sequence) ? sequence : 0;
  },

  toNewestFirst(entries) {
    return (entries || []).slice().reverse();
  },

  mergeLogEntries(prefix, suffix) {
    const seen = {};
    return prefix.concat(suffix).filter(item => {
      const key = `${item.sequence}`;
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  },

  shouldContinueRangeFetch(entries, after, cursor, page) {
    if (!this.hasTimeFilter()) {
      return false;
    }
    if (!entries || entries.length < LOG_PAGE_SIZE) {
      return false;
    }
    if (!cursor || cursor <= after) {
      return false;
    }
    if (page + 1 >= RANGE_AUTO_PAGE_LIMIT) {
      return false;
    }
    return this.data.logs.length < RANGE_MAX_LOG_ROWS;
  },

  finishLogFetch(done) {
    this.setData({ loading: false }, () => {
      if (!this.data.readingHistory) {
        this.scrollLogsToTop();
      }
    });
    if (done) {
      done();
    }
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
        wx.showToast({ title: "日志请求失败", icon: "none" });
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

  getValidLevel(level) {
    return LEVELS.some(item => item.key === level) ? level : "ALL";
  },

  scrollLogsToBottom() {
    const scrollTop = (this.logScrollTop || 100000) + 100000;
    this.logScrollTop = scrollTop;
    const update = () => {
      this.setData({
        bottomAnchor: "log-bottom",
        terminalScrollTop: scrollTop
      });
    };
    if (wx.nextTick) {
      wx.nextTick(update);
      return;
    }
    setTimeout(update, 30);
  },

  scrollLogsToTop() {
    this.setData({
      bottomAnchor: "",
      terminalScrollTop: 0
    });
  },

  initDateRange() {
    const now = new Date();
    const today = this.formatDate(now);
    const range = this.buildDateTimeRange(now.getFullYear(), now.getMonth() + 1);
    const index = this.getDateTimeIndex(now, range);
    this.setData({
      dateEnd: today,
      startDateTimeRange: range,
      endDateTimeRange: range,
      startDateTimeIndex: index,
      endDateTimeIndex: index
    });
  },

  buildDateTime(date, time, defaultTime) {
    if (!date) {
      return "";
    }
    return `${date}T${time || defaultTime}:00`;
  },

  buildDateTimeRange(year, month) {
    const years = this.buildNumberRange(2020, Math.max(new Date().getFullYear() + 1, 2099));
    const months = this.buildNumberRange(1, 12);
    const days = this.buildNumberRange(1, this.getDaysInMonth(year, month));
    const hours = this.buildNumberRange(0, 23);
    const minutes = this.buildNumberRange(0, 59);
    return [years, months, days, hours, minutes];
  },

  buildNumberRange(start, end) {
    const values = [];
    for (let value = start; value <= end; value += 1) {
      values.push(value < 10 ? `0${value}` : `${value}`);
    }
    return values;
  },

  getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  },

  getDateTimeIndex(date, range) {
    const values = [
      `${date.getFullYear()}`,
      this.pad(date.getMonth() + 1),
      this.pad(date.getDate()),
      this.pad(date.getHours()),
      this.pad(date.getMinutes())
    ];
    return values.map((value, column) => Math.max(range[column].indexOf(value), 0));
  },

  getDateTimeByIndex(index, range) {
    const year = range[0][index[0]] || range[0][0];
    const month = range[1][index[1]] || range[1][0];
    const day = range[2][index[2]] || range[2][0];
    const hour = range[3][index[3]] || range[3][0];
    const minute = range[4][index[4]] || range[4][0];
    return {
      date: `${year}-${month}-${day}`,
      time: `${hour}:${minute}`,
      text: `${year}-${month}-${day} ${hour}:${minute}`
    };
  },

  parseLocalDateTime(date, time) {
    if (!date) {
      return null;
    }
    const parts = date.split("-").map(value => Number(value));
    const timeParts = (time || "00:00").split(":").map(value => Number(value));
    if (parts.length !== 3 || parts.some(value => Number.isNaN(value))) {
      return null;
    }
    return new Date(parts[0], parts[1] - 1, parts[2], timeParts[0] || 0, timeParts[1] || 0);
  },

  pad(value) {
    return value < 10 ? `0${value}` : `${value}`;
  },

  getEmptyText() {
    if (this.data.startDate || this.data.endDate) {
      return "该时间范围暂无日志";
    }
    return this.data.activeLevel === "ALL" ? "暂无日志" : "暂无该级别日志";
  },

  formatDate(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  toLogItem(entry) {
    const level = entry.level || "INFO";
    return Object.assign({}, entry, {
      level,
      levelClass: level.toLowerCase(),
      displayTime: (entry.timestamp || "").replace("T", " "),
      logger: entry.logger || "system",
      message: entry.message || "",
      throwable: entry.throwable || ""
    });
  }
});
