const { request } = require("../../utils/request");

const TYPE_OPTIONS = [
  { key: "text", label: "普通文本", icon: "文" },
  { key: "flow", label: "工作流", icon: "流" }
];

const CRON_PRESETS = [
  { label: "每天 08:00", value: "0 0 8 * * ?" },
  { label: "工作日 09:00", value: "0 0 9 ? * MON-FRI" },
  { label: "每周一 10:00", value: "0 0 10 ? * MON" },
  { label: "每月 1 日", value: "0 0 9 1 * ?" }
];

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return `${year}-${month}-${day}`;
}

function getCurrentTime() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

function createField(name, value) {
  return {
    key: `field-${Date.now()}-${Math.random()}`,
    name: name || "data",
    value: value || ""
  };
}

function createDefaultForm() {
  return {
    id: "",
    title: "喝水提醒",
    type: "text",
    cron: "0 0 8 * * ?",
    data: "喝水、提交周报、账单到期",
    exeCode: "",
    dataField: "data",
    fields: [createField("data", "喝水、提交周报、账单到期")],
    enabled: true
  };
}

Page({
  data: {
    connectionText: "未连接",
    connectionClass: "idle",
    loading: false,
    saving: false,
    testPassed: false,
    testedCron: "",
    typeOptions: TYPE_OPTIONS,
    execCodeOptions: [],
    execCodeIndex: 0,
    selectedExecCodeTitle: "",
    cronPresets: CRON_PRESETS,
    editingId: "",
    isEditing: false,
    reminders: [],
    form: createDefaultForm(),
    fieldSectionTitle: "提醒字段",
    showFieldEditor: true,
    showAddFieldButton: true,
    fieldEmptyText: "",
    testDate: getToday(),
    testTime: getCurrentTime(),
    cronPreview: {
      valid: false,
      message: "",
      nextTimes: []
    },
    previewingCron: false,
    showCronPreviewDialog: false,
    previewJson: ""
  },

  onLoad(options) {
    this.pendingEditId = options && options.id ? decodeURIComponent(options.id) : "";
    this.refreshPreview();
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
        this.setData({ connectionText: "已连接", connectionClass: "online" });
        this.fetchExecCodes();
      },
      fail: () => {
        this.applyExecCodeOptions([]);
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

  fetchExecCodes() {
    this.request({
      path: "/api/reminders/exe-codes",
      method: "GET",
      success: (payload) => {
        const options = Array.isArray(payload.data) ? payload.data : [];
        const execCodeOptions = options
          .filter(item => item && item.code)
          .map(item => ({
            code: item.code,
            name: item.name || item.title || item.code,
            title: item.title || item.name || item.code,
            sample: item.sample || "{}",
            fields: this.createFieldsFromExecutionOption(item)
          }));
        this.applyExecCodeOptions(execCodeOptions);
      },
      fail: () => {
        this.applyExecCodeOptions([]);
      }
    });
  },

  selectType(event) {
    if (this.data.isEditing) {
      wx.showToast({ title: "编辑时不能修改提醒类型", icon: "none" });
      return;
    }
    const type = event.currentTarget.dataset.key;
    const form = Object.assign({}, this.data.form, { type });
    const next = { form };
    if (type === "flow") {
      const option = this.getExecCodeOption(form.exeCode) || this.getExecCodeOption(this.getDefaultExecCode());
      if (option) {
        form.exeCode = option.code;
        form.title = option.title;
        form.fields = this.createFieldsFromExecutionOption(option);
      }
      next.execCodeIndex = option ? this.getExecCodeIndex(option.code) : 0;
      next.selectedExecCodeTitle = option ? option.title : "";
    } else {
      form.exeCode = "";
      form.fields = this.createTextFields();
      next.execCodeIndex = 0;
      next.selectedExecCodeTitle = "";
    }
    this.setData(next, () => this.refreshPreview());
  },

  setField(event) {
    const field = event.currentTarget.dataset.field;
    this.applyFieldValue(field, event.detail.value);
  },

  setJsonField(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    this.applyJsonFieldValue(index, field, event.detail.value);
  },

  cacheField(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) {
      return;
    }
    this.fieldDraft = Object.assign({}, this.fieldDraft || {}, {
      [field]: event.detail.value
    });
  },

  cacheJsonField(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    if (Number.isNaN(index) || !field) {
      return;
    }
    this.jsonFieldDraft = Object.assign({}, this.jsonFieldDraft || {}, {
      [`${index}:${field}`]: event.detail.value
    });
  },

  applyFieldValue(field, value) {
    if (!field) {
      return;
    }
    if ((this.data.form[field] || "") === (value || "")) {
      return;
    }
    this.setData({
      form: Object.assign({}, this.data.form, {
        [field]: value
      })
    }, () => this.refreshPreview());
  },

  applyJsonFieldValue(index, field, value) {
    const fields = this.normalizeFieldList(this.data.form).map(item => Object.assign({}, item));
    if (!fields[index]) {
      return;
    }
    if ((fields[index][field] || "") === (value || "")) {
      return;
    }
    fields[index][field] = value;
    this.setData({
      form: Object.assign({}, this.data.form, { fields })
    }, () => this.refreshPreview());
  },

  commitDraftInputs(options) {
    const fieldDraft = this.fieldDraft || {};
    const jsonFieldDraft = this.jsonFieldDraft || {};
    const fieldKeys = Object.keys(fieldDraft);
    const jsonKeys = Object.keys(jsonFieldDraft);
    if (!fieldKeys.length && !jsonKeys.length) {
      this.lastDraftChanged = false;
      return this.data.form;
    }

    const form = Object.assign({}, this.data.form);
    let changed = false;
    fieldKeys.forEach(field => {
      const value = fieldDraft[field];
      if ((form[field] || "") !== (value || "")) {
        form[field] = value;
        changed = true;
      }
    });
    if (jsonKeys.length) {
      const fields = this.normalizeFieldList(form).map(item => Object.assign({}, item));
      jsonKeys.forEach(key => {
        const parts = key.split(":");
        const index = Number(parts[0]);
        const field = parts[1];
        if (!fields[index] || !field) {
          return;
        }
        const value = jsonFieldDraft[key];
        if ((fields[index][field] || "") !== (value || "")) {
          fields[index][field] = value;
          changed = true;
        }
      });
      form.fields = fields;
    }

    this.fieldDraft = {};
    this.jsonFieldDraft = {};
    this.lastDraftChanged = changed;
    if (changed) {
      const nextData = { form };
      if (!options || options.invalidateTest !== false) {
        nextData.testPassed = false;
        nextData.testedCron = "";
      }
      this.setData(nextData, () => {
        if (!options || options.refresh !== false) {
          this.refreshPreview(options && options.previewOptions);
        }
      });
    }
    return form;
  },

  addJsonField() {
    if (this.data.form.type === "flow") {
      return;
    }
    const fields = this.normalizeFieldList(this.data.form).concat([createField("", "")]);
    this.setData({
      form: Object.assign({}, this.data.form, { fields })
    }, () => this.refreshPreview());
  },

  removeJsonField(event) {
    const index = Number(event.currentTarget.dataset.index);
    const fields = this.normalizeFieldList(this.data.form).filter((item, itemIndex) => itemIndex !== index);
    const fallbackFields = this.getDefaultFieldsForForm(this.data.form);
    this.setData({
      form: Object.assign({}, this.data.form, {
        fields: fields.length ? fields : fallbackFields
      })
    }, () => this.refreshPreview());
  },

  changeExecCode(event) {
    if (this.data.isEditing) {
      wx.showToast({ title: "编辑时不能修改执行编码", icon: "none" });
      return;
    }
    const index = Number(event.detail.value);
    const option = this.data.execCodeOptions[index];
    if (!option) {
      return;
    }
    this.applyExecCodeSelection(option, index, true);
  },

  applyExecCodeSelection(option, index, shouldFetchSample) {
    this.setData({
      execCodeIndex: index,
      selectedExecCodeTitle: option.title,
      form: Object.assign({}, this.data.form, {
        title: option.title,
        exeCode: option.code,
        type: "flow",
        fields: this.createFieldsFromExecutionOption(option)
      })
    }, () => {
      this.refreshPreview();
      if (shouldFetchSample) {
        this.fetchExecCodeSample(option.code);
      }
    });
  },

  fetchExecCodeSample(code) {
    const seq = (this.execCodeSampleSeq || 0) + 1;
    this.execCodeSampleSeq = seq;
    this.request({
      path: `/api/reminders/exe-codes/${encodeURIComponent(code)}/sample`,
      method: "GET",
      success: (payload) => {
        if (seq !== this.execCodeSampleSeq || this.data.form.exeCode !== code || this.data.isEditing) {
          return;
        }
        const data = payload.data || {};
        const sample = data.sample || "{}";
        const fields = this.createFieldsFromSample(sample);
        const execCodeOptions = this.data.execCodeOptions.map(item => {
          if (item.code !== code) {
            return item;
          }
          return Object.assign({}, item, {
            sample,
            fields
          });
        });
        this.setData({
          execCodeOptions,
          form: Object.assign({}, this.data.form, { fields })
        }, () => this.refreshPreview());
      }
    });
  },

  selectCronPreset(event) {
    this.setData({
      form: Object.assign({}, this.data.form, {
        cron: event.currentTarget.dataset.value
      })
    }, () => this.refreshPreview());
  },

  setTestDate(event) {
    this.setData({
      testDate: event.detail.value,
      testPassed: false,
      testedCron: ""
    });
  },

  setTestTime(event) {
    this.setData({
      testTime: event.detail.value,
      testPassed: false,
      testedCron: ""
    });
  },

  showCronPreview() {
    const form = this.commitDraftInputs({ refresh: false });
    const cron = (form.cron || "").trim();
    if (!cron) {
      wx.showToast({ title: "请先填写 Cron 表达式", icon: "none" });
      return;
    }
    if (this.cronPreviewTimer) {
      clearTimeout(this.cronPreviewTimer);
      this.cronPreviewTimer = null;
    }
    this.pendingCronPreview = cron;
    this.fetchCronPreview(cron, { showDialog: true });
  },

  saveReminder() {
    if (this.data.saving) {
      return;
    }
    const draftForm = this.commitDraftInputs({ refresh: false });
    const form = this.normalizeForm(draftForm);
    const draftChanged = this.lastDraftChanged;
    if (this.lastDraftChanged) {
      this.setData({
        testPassed: false,
        testedCron: ""
      });
    }
    if (!form.title || !form.cron) {
      wx.showToast({ title: "请补全名称和 Cron", icon: "none" });
      return;
    }
    if (form.type === "flow" && !form.exeCode) {
      wx.showToast({ title: "请选择执行编码", icon: "none" });
      return;
    }
    if (draftChanged || !this.isCronTestPassed(form.cron)) {
      wx.showToast({ title: "表达式变更后需重新测试", icon: "none" });
      return;
    }

    const editingId = this.data.editingId;
    this.setData({ saving: true, loading: true });
    this.request({
      path: editingId ? `/api/reminders/${editingId}` : "/api/reminders",
      method: editingId ? "PUT" : "POST",
      data: form,
      success: (payload) => {
        const data = payload.data || {};
        const saved = data.item || null;
        this.applyDashboard(data.dashboard || {});
        if (saved && saved.id) {
          this.setData({
            editingId: saved.id,
            isEditing: true,
            form: this.toEditorForm(saved)
          }, () => this.refreshPreview({ keepTestPassed: true }));
        }
        wx.showToast({ title: "已保存", icon: "success" });
        this.refreshPreviousPageAndBack();
      },
      complete: () => {
        this.setData({ saving: false, loading: false });
      }
    });
  },

  refreshPreviousPageAndBack() {
    const pages = getCurrentPages();
    if (!pages || pages.length < 2) {
      return;
    }
    const previousPage = pages[pages.length - 2];
    if (previousPage && typeof previousPage.fetchDashboard === "function") {
      previousPage.fetchDashboard();
    }
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 350);
  },

  resetForm() {
    if (this.data.isEditing) {
      const target = this.data.reminders.find(item => item.id === this.data.editingId);
      if (!target) {
        wx.showToast({ title: "未找到原配置", icon: "none" });
        return;
      }
      this.setData({
        form: this.toEditorForm(target),
        testedCron: ""
      }, () => this.refreshPreview());
      return;
    }
    const form = createDefaultForm();
    this.setData({
      editingId: "",
      isEditing: false,
      form,
      testedCron: ""
    }, () => this.refreshPreview());
  },

  testSend() {
    const draftForm = this.commitDraftInputs({ refresh: false });
    const form = this.normalizeForm(draftForm);
    if (form.type === "flow" && !form.exeCode) {
      wx.showToast({ title: "请选择执行编码", icon: "none" });
      return;
    }
    this.setData({
      testPassed: false,
      testedCron: ""
    });
    form.testDate = `${this.data.testDate} ${this.data.testTime}`;
    this.setData({ loading: true });
    this.request({
      path: "/api/reminders/test",
      method: "POST",
      data: form,
      success: (payload) => {
        const data = payload.data || {};
        if (data.sent) {
          this.setData({
            testPassed: true,
            testedCron: form.cron
          });
          wx.showToast({ title: "已发送测试提醒", icon: "success" });
          return;
        }
        this.setData({
          testPassed: false,
          testedCron: ""
        });
        wx.showModal({
          title: data.matched === false ? "测试日期未命中" : "测试发送失败",
          content: data.message || "测试发送失败",
          showCancel: false
        });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  copyPreview() {
    const form = this.commitDraftInputs({ refresh: false });
    const previewJson = JSON.stringify([this.buildPayload(this.normalizeForm(form))], null, 2);
    this.setData({ previewJson });
    wx.setClipboardData({
      data: previewJson,
      success: () => wx.showToast({ title: "JSON 已复制", icon: "success" })
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

  applyDashboard(dashboard) {
    const reminders = Array.isArray(dashboard.items) ? dashboard.items : [];
    this.setData({ reminders }, () => {
      this.applyPendingEdit();
    });
  },

  applyPendingEdit() {
    if (!this.pendingEditId) {
      return;
    }
    const target = this.data.reminders.find(item => item.id === this.pendingEditId);
    if (!target) {
      return;
    }
    this.setData({
      editingId: target.id,
      isEditing: true,
      form: this.toEditorForm(target)
    }, () => this.refreshPreview());
    this.pendingEditId = "";
  },

  applyExecCodeOptions(execCodeOptions) {
    const currentCode = this.data.form.exeCode;
    const matched = execCodeOptions.some(item => item.code === currentCode);
    const nextCode = matched ? currentCode : (execCodeOptions[0] ? execCodeOptions[0].code : "");
    const nextOption = execCodeOptions.find(item => item.code === nextCode);
    const form = Object.assign({}, this.data.form, {
      exeCode: nextCode
    });
    if (form.type === "flow" && !matched && nextOption) {
      form.title = nextOption.title;
      form.fields = this.createFieldsFromExecutionOption(nextOption);
    } else if (form.type === "flow" && nextOption && !this.hasConfiguredFields(form)) {
      form.fields = this.createFieldsFromExecutionOption(nextOption);
    }
    this.setData({
      execCodeOptions,
      execCodeIndex: this.getExecCodeIndex(nextCode, execCodeOptions),
      selectedExecCodeTitle: nextOption ? nextOption.title : "",
      form
    }, () => this.refreshPreview());
  },

  createFieldsFromExecutionOption(option) {
    if (!option) {
      return [];
    }
    const sampleFields = this.createFieldsFromSample(option.sample);
    if (sampleFields.length) {
      return sampleFields;
    }
    return this.createFieldsFromTemplates(option.fields);
  },

  createFieldsFromTemplates(fields) {
    return (fields || []).map(item => createField(item.name, item.value || ""));
  },

  createFieldsFromSample(sample) {
    const value = this.parseSample(sample);
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return [];
    }
    return Object.keys(value)
      .filter(name => this.isPayloadFieldName(name))
      .map(name => createField(name, this.stringifySampleValue(value[name])));
  },

  isPayloadFieldName(name) {
    return [
      "id",
      "title",
      "type",
      "enabled",
      "deleted",
      "cron",
      "corn",
      "exeCode",
      "dataField",
      "testDate",
      "fields",
      "updatedAt"
    ].indexOf(name) < 0;
  },

  parseSample(sample) {
    if (!sample) {
      return {};
    }
    if (typeof sample === "object") {
      return sample;
    }
    try {
      return JSON.parse(sample);
    } catch (error) {
      return {};
    }
  },

  stringifySampleValue(value) {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value, null, 2);
  },

  createTextFields() {
    return [createField("data", "")];
  },

  hasConfiguredFields(form) {
    return Array.isArray(form.fields) && form.fields.some(item => item && ((item.name || "").trim() || item.value));
  },

  getFieldState(form) {
    if (form.type === "flow") {
      const option = this.getExecCodeOption(form.exeCode);
      const templateFields = this.createFieldsFromExecutionOption(option);
      return {
        title: "填充字段",
        showEditor: templateFields.length > 0 || this.hasConfiguredFields(form),
        emptyText: "该工作流无需填充字段"
      };
    }
    return {
      title: "提醒字段",
      showEditor: true,
      emptyText: ""
    };
  },

  refreshPreview(options) {
    const form = this.ensureFieldsForCurrentSelection(this.data.form);
    const payload = this.buildPayload(this.normalizeForm(form));
    const fieldState = this.getFieldState(form);
    const nextData = {
      form,
      previewJson: JSON.stringify([payload], null, 2),
      fieldSectionTitle: fieldState.title,
      showFieldEditor: fieldState.showEditor,
      showAddFieldButton: fieldState.showEditor && form.type !== "flow",
      fieldEmptyText: fieldState.emptyText
    };
    if (!options || options.keepTestPassed !== true) {
      nextData.testPassed = false;
      nextData.testedCron = "";
    }
    this.setData(nextData, () => this.scheduleCronPreview(this.data.form.cron));
  },

  ensureFieldsForCurrentSelection(form) {
    if (!form || form.type !== "flow" || this.hasConfiguredFields(form)) {
      return form;
    }
    const option = this.getExecCodeOption(form.exeCode);
    const fields = this.createFieldsFromExecutionOption(option);
    if (!fields.length) {
      return form;
    }
    return Object.assign({}, form, { fields });
  },

  isCronTestPassed(cron) {
    return this.data.testPassed && (cron || "").trim() === (this.data.testedCron || "").trim();
  },

  scheduleCronPreview(cron) {
    const value = (cron || "").trim();
    if (this.cronPreviewTimer) {
      clearTimeout(this.cronPreviewTimer);
      this.cronPreviewTimer = null;
    }
    if (!value) {
      this.pendingCronPreview = "";
      this.setData({
        previewingCron: false,
        cronPreview: {
          valid: false,
          message: "请先填写 Cron 表达式",
          nextTimes: []
        }
      });
      return;
    }
    this.pendingCronPreview = value;
    this.cronPreviewTimer = setTimeout(() => this.fetchCronPreview(value), 300);
  },

  fetchCronPreview(cron, options) {
    const expectedCron = cron;
    this.setData({ previewingCron: true });
    request({
      path: "/api/reminders/cron/preview",
      method: "POST",
      data: { cron },
      success: (res) => {
        if (expectedCron !== this.pendingCronPreview) {
          return;
        }
        const data = res && res.data && res.data.data ? res.data.data : {};
        const preview = {
          valid: !!data.valid,
          message: data.message || "无法计算生效时间",
          nextTimes: Array.isArray(data.nextTimes) ? data.nextTimes : []
        };
        this.setData({ cronPreview: preview }, () => {
          if (options && options.showDialog) {
            this.showCronPreviewModal(preview);
          }
        });
      },
      fail: () => {
        if (expectedCron !== this.pendingCronPreview) {
          return;
        }
        const preview = {
          valid: false,
          message: "无法计算生效时间",
          nextTimes: []
        };
        this.setData({ cronPreview: preview }, () => {
          if (options && options.showDialog) {
            this.showCronPreviewModal(preview);
          }
        });
      },
      complete: () => {
        if (expectedCron === this.pendingCronPreview) {
          this.setData({ previewingCron: false });
        }
      }
    });
  },

  showCronPreviewModal(preview) {
    this.setData({
      cronPreview: Object.assign({
        valid: false,
        message: "暂无可用时间",
        nextTimes: []
      }, preview || {}),
      showCronPreviewDialog: true
    });
  },

  closeCronPreviewModal() {
    this.setData({ showCronPreviewDialog: false });
  },

  noop() {
  },

  getDefaultExecCode() {
    return this.data.execCodeOptions[0] ? this.data.execCodeOptions[0].code : "";
  },

  getExecCodeOption(code) {
    return this.data.execCodeOptions.find(item => item.code === code) || null;
  },

  getExecCodeIndex(code, options) {
    const source = options || this.data.execCodeOptions;
    const index = source.findIndex(item => item.code === code);
    return index >= 0 ? index : 0;
  },

  toEditorForm(item) {
    return Object.assign(createDefaultForm(), item, {
      fields: this.normalizeFieldList(item)
    });
  },

  normalizeFieldList(form) {
    const source = Array.isArray(form.fields) ? form.fields : [];
    const fields = source
      .map(item => createField((item.name || "").trim(), item.value || ""))
      .filter(item => item.name || item.value);
    if (fields.length) {
      return fields;
    }
    return this.getDefaultFieldsForForm(form);
  },

  getDefaultFieldsForForm(form) {
    if (form.type === "flow") {
      const option = this.getExecCodeOption(form.exeCode);
      return this.createFieldsFromExecutionOption(option);
    }
    return [createField(form.dataField || "data", form.data || "")];
  },

  normalizeForm(form) {
    const fields = this.normalizeFieldList(form)
      .map(item => ({
        name: (item.name || "").trim(),
        value: item.value || ""
      }))
      .filter(item => item.name);
    const firstField = fields[0] || { name: "data", value: "" };
    return {
      id: form.id || this.data.editingId || "",
      title: (form.title || "").trim(),
      type: form.type || "text",
      cron: (form.cron || "").trim(),
      data: (firstField.value || "").trim(),
      exeCode: (form.exeCode || "").trim(),
      dataField: (firstField.name || "data").trim(),
      fields,
      enabled: !!form.enabled
    };
  },

  buildPayload(form) {
    const payload = {};
    if (form.cron) {
      payload.cron = form.cron;
    }

    if (form.type === "flow") {
      payload.exeCode = form.exeCode;
    }

    (form.fields || []).forEach(field => {
      if (field.name) {
        payload[field.name] = this.parseData(field.value || "");
      }
    });
    return payload;
  },

  parseData(value) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  },

  getTypeLabel(type) {
    const option = TYPE_OPTIONS.find(item => item.key === type);
    return option ? option.label : "普通文本";
  },

  getTypeInitial(type) {
    const option = TYPE_OPTIONS.find(item => item.key === type);
    return option ? option.icon : "文";
  },

  getSummary(item) {
    if (item.type === "flow") {
      return item.exeCode || "未选择任务代码";
    }
    const fields = this.normalizeFieldList(item);
    const first = fields[0] || {};
    return first.value || item.data || "未填写提醒内容";
  },

  getMeta(item) {
    return item.cron || "未设置 Cron";
  }
});
