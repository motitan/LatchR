(() => {
  const MS_PER_SECOND = 1000;
  const DEFAULT_TIMELINE_SECONDS = 4 * 60 * 60;

  const elements = {
    video: document.getElementById("video"),
    youtubeWrap: document.getElementById("youtubeWrap"),
    youtubePlayerHost: document.getElementById("youtubePlayerHost"),

    timeline: document.getElementById("timeline"),
    loadBtn: document.getElementById("loadBtn"),
    exportBtn: document.getElementById("exportBtn"),
    lockBtn: document.getElementById("lockBtn"),

    useDefaultVideoBtn: document.getElementById("useDefaultVideoBtn"),
    localVideoInput: document.getElementById("localVideoInput"),
    youtubeUrlInput: document.getElementById("youtubeUrlInput"),
    loadYoutubeBtn: document.getElementById("loadYoutubeBtn"),

    templatePathInput: document.getElementById("templatePathInput"),
    loadTemplatePathBtn: document.getElementById("loadTemplatePathBtn"),
    templateFileInput: document.getElementById("templateFileInput"),
    templateMeta: document.getElementById("templateMeta"),
    templateCanvas: document.getElementById("templateCanvas"),
    templateTags: document.getElementById("templateTags"),
    templateLabels: document.getElementById("templateLabels"),

    status: document.getElementById("status"),
    selId: document.getElementById("selId"),
    selLabel: document.getElementById("selLabel"),
    selStart: document.getElementById("selStart"),
    selEnd: document.getElementById("selEnd"),
  };

  let timeline;
  let items;
  let groups;
  let timelineMaxSeconds = DEFAULT_TIMELINE_SECONDS;
  let isLocked = false;
  let selectedId = null;
  const eventsById = new Map();
  const eventGroupById = new Map();
  const templateState = {
    tags: [],
    labels: [],
    tagsById: new Map(),
    labelsById: new Map(),
    activeActionKey: null,
    activeActionLabel: "",
    activeActionStartSeconds: null,
    activeActionData: null,
  };

  const playerState = {
    mode: "html5",
    youtubePlayer: null,
    youtubePollTimer: null,
    youtubeApiPromise: null,
    localObjectUrl: null,
  };

  function secondsToDate(seconds) {
    return new Date(Math.max(0, seconds) * MS_PER_SECOND);
  }

  function dateToSeconds(dateLike) {
    const ms = dateLike instanceof Date ? dateLike.getTime() : new Date(dateLike).getTime();
    return ms / MS_PER_SECOND;
  }

  function formatSeconds(seconds) {
    return Number(seconds).toFixed(3);
  }

  function pad2(value) {
    return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
  }

  function formatClock(seconds, includeSeconds = false) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const whole = Math.floor(safeSeconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;

    if (includeSeconds) {
      return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
    }
    return `${pad2(hours)}:${pad2(minutes)}`;
  }

  function formatAxisLabel(dateLike, scale) {
    const seconds = dateToSeconds(dateLike);
    if (scale === "millisecond" || scale === "second") {
      return formatClock(seconds, true);
    }
    return formatClock(seconds, false);
  }

  function roundToTenth(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(value * 10) / 10;
  }

  function getTimelineMaxSeconds() {
    return Math.max(1, Number(timelineMaxSeconds) || DEFAULT_TIMELINE_SECONDS);
  }

  function getAxisConfigForDuration(durationSeconds) {
    const duration = Math.max(1, Number(durationSeconds) || DEFAULT_TIMELINE_SECONDS);
    if (duration <= 12 * 60) {
      return { scale: "second", step: 15 };
    }
    if (duration <= 30 * 60) {
      return { scale: "second", step: 30 };
    }
    if (duration <= 90 * 60) {
      return { scale: "minute", step: 2 };
    }
    if (duration <= 3 * 60 * 60) {
      return { scale: "minute", step: 5 };
    }
    return { scale: "minute", step: 10 };
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function setSelectionPanel(eventData) {
    if (!eventData) {
      elements.selId.value = "";
      elements.selLabel.value = "";
      elements.selLabel.disabled = true;
      elements.selStart.value = "";
      elements.selEnd.value = "";
      return;
    }

    elements.selId.value = eventData.id;
    elements.selLabel.disabled = false;
    elements.selLabel.value = eventData.label;
    elements.selStart.value = formatSeconds(eventData.start);
    elements.selEnd.value = formatSeconds(eventData.end);
  }

  function normalizeKey(text) {
    return String(text ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function buildGroupId(seed, usedIds) {
    const normalized = normalizeKey(seed).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const base = normalized || "unlabeled";
    let groupId = `grp_${base}`;
    let suffix = 2;
    while (usedIds.has(groupId)) {
      groupId = `grp_${base}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(groupId);
    return groupId;
  }

  function toTimelineItem(eventData, groupId) {
    return {
      id: eventData.id,
      type: "range",
      content: "",
      title: `${eventData.label || "Event"} | ${formatSeconds(eventData.start)}s - ${formatSeconds(
        eventData.end
      )}s`,
      className: "timeline-event-item",
      group: groupId,
      start: secondsToDate(eventData.start),
      end: secondsToDate(eventData.end),
    };
  }

  function normalizeEvent(raw, index) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const start = Number(raw.start);
    const end = Number(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }

    const maxSeconds = getTimelineMaxSeconds();
    const clampedStart = Math.max(0, Math.min(start, maxSeconds));
    const clampedEnd = Math.max(clampedStart, Math.min(end, maxSeconds));

    const defaultId = `evt_${String(index + 1).padStart(3, "0")}`;
    return {
      id: String(raw.id ?? defaultId),
      start: clampedStart,
      end: clampedEnd,
      label: typeof raw.label === "string" ? raw.label : "",
    };
  }

  function clampAllEventsToTimelineMax() {
    const maxSeconds = getTimelineMaxSeconds();
    eventsById.forEach((eventData) => {
      eventData.start = Math.max(0, Math.min(eventData.start, maxSeconds));
      eventData.end = Math.max(eventData.start, Math.min(eventData.end, maxSeconds));
    });
  }

  function applyTimelineBounds(resetWindow = false) {
    if (!timeline) {
      return;
    }

    const maxSeconds = getTimelineMaxSeconds();
    const axisConfig = getAxisConfigForDuration(maxSeconds);

    timeline.setOptions({
      min: secondsToDate(0),
      max: secondsToDate(maxSeconds),
      timeAxis: axisConfig,
      zoomMax: maxSeconds * MS_PER_SECOND,
    });

    if (resetWindow) {
      timeline.setWindow(secondsToDate(0), secondsToDate(maxSeconds), { animation: false });
    }
  }

  function setTimelineMaxFromDuration(durationSeconds, resetWindow = true) {
    const parsed = Number(durationSeconds);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    const nextMax = Math.max(1, parsed);
    const changed = Math.abs(nextMax - timelineMaxSeconds) >= 0.25;
    if (!changed && !resetWindow) {
      return;
    }

    timelineMaxSeconds = nextMax;
    clampAllEventsToTimelineMax();
    refreshTimelineFromModel();
    applyTimelineBounds(resetWindow);
    updatePlayhead(getCurrentPlayerTime());
  }

  function updateTimelineEditableState() {
    timeline.setOptions({
      editable: {
        add: false,
        remove: false,
        updateGroup: false,
        updateTime: !isLocked,
      },
    });
    elements.lockBtn.textContent = isLocked ? "Unlock" : "Lock";
  }

  function selectEventById(id, shouldSeek = true) {
    const eventData = eventsById.get(String(id));
    if (!eventData) {
      selectedId = null;
      timeline.setSelection([]);
      setSelectionPanel(null);
      return;
    }

    selectedId = eventData.id;
    timeline.setSelection([selectedId], { focus: false });
    setSelectionPanel(eventData);

    if (shouldSeek) {
      seekPlayer(eventData.start);
    }
  }

  function getActiveDuration() {
    if (playerState.mode === "youtube") {
      const duration = Number(playerState.youtubePlayer?.getDuration?.());
      return Number.isFinite(duration) && duration > 0 ? duration : NaN;
    }

    const duration = Number(elements.video.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : NaN;
  }

  function clampSeconds(seconds) {
    const duration = getActiveDuration();
    if (Number.isFinite(duration)) {
      return Math.max(0, Math.min(seconds, duration));
    }
    return Math.max(0, seconds);
  }

  function seekPlayer(seconds) {
    if (!Number.isFinite(seconds)) {
      return;
    }

    const clamped = clampSeconds(seconds);

    if (playerState.mode === "youtube") {
      try {
        playerState.youtubePlayer?.seekTo?.(clamped, true);
      } catch (_error) {
        // Ignore until player is ready.
      }
      updatePlayhead(clamped);
      return;
    }

    try {
      elements.video.currentTime = clamped;
    } catch (_error) {
      // Ignore seek errors until metadata is ready.
    }

    updatePlayhead(clamped);
  }

  function getCurrentPlayerTime() {
    if (playerState.mode === "youtube") {
      const currentTime = Number(playerState.youtubePlayer?.getCurrentTime?.());
      return Number.isFinite(currentTime) ? currentTime : 0;
    }

    const currentTime = Number(elements.video.currentTime);
    return Number.isFinite(currentTime) ? currentTime : 0;
  }

  function buildNextEventId() {
    let maxIdNumber = 0;
    eventsById.forEach((eventData) => {
      const match = String(eventData.id).match(/^evt_(\d+)$/);
      if (!match) {
        return;
      }
      const number = Number(match[1]);
      if (Number.isFinite(number)) {
        maxIdNumber = Math.max(maxIdNumber, number);
      }
    });
    return `evt_${String(maxIdNumber + 1).padStart(3, "0")}`;
  }

  function createEventFromTemplateAction(action, startSeconds, endSeconds) {
    if (!action || !action.label) {
      setStatus("Template item has no tag/label mapping to create an event.");
      return;
    }

    const maxSeconds = getTimelineMaxSeconds();
    const defaultNow = Math.max(0, Math.min(getCurrentPlayerTime(), maxSeconds));
    let start = Number.isFinite(Number(startSeconds))
      ? Number(startSeconds)
      : defaultNow - (Number(action.preRoll) || 0);
    let end = Number.isFinite(Number(endSeconds))
      ? Number(endSeconds)
      : defaultNow + (Number(action.postRoll) || 0);

    start = Math.max(0, Math.min(start, maxSeconds));
    end = Math.max(0, Math.min(end, maxSeconds));

    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    const minLength = 0.1;
    if (end - start < minLength) {
      if (start + minLength <= maxSeconds) {
        end = start + minLength;
      } else {
        start = Math.max(0, maxSeconds - minLength);
        end = maxSeconds;
      }
    }

    start = roundToTenth(start);
    end = roundToTenth(end);
    if (end <= start) {
      end = roundToTenth(Math.min(maxSeconds, start + 0.1));
    }

    const newEvent = {
      id: buildNextEventId(),
      start,
      end,
      label: action.label,
    };

    eventsById.set(newEvent.id, newEvent);
    refreshTimelineFromModel();
    selectEventById(newEvent.id, false);

    setStatus(
      `Added ${newEvent.label} (${formatSeconds(newEvent.start)}s-${formatSeconds(newEvent.end)}s).`
    );
  }

  function updatePlayhead(seconds) {
    const maxSeconds = getTimelineMaxSeconds();
    const clamped = Math.max(0, Math.min(Number(seconds) || 0, maxSeconds));
    try {
      timeline.setCustomTime(secondsToDate(clamped), "playhead");
    } catch (_error) {
      // Ignore if timeline/custom time is not initialized yet.
    }
  }

  function normalizeTemplateTags(tags) {
    return tags.map((tag, index) => {
      const rawId = tag["tag_template-id"];
      const rawName = tag["tag_template-name"];
      const rawShortName = tag["tag_template-short_name"];
      return {
        id: rawId ?? index + 1,
        name: String(rawName ?? `Tag ${index + 1}`).trim() || `Tag ${index + 1}`,
        shortName: String(rawShortName ?? "").trim(),
      };
    });
  }

  function rebuildTimelineData() {
    const timelineEvents = Array.from(eventsById.values());
    const groupDefs = [];
    const usedGroupIds = new Set();
    const keyToGroupId = new Map();

    // Prefer template tags as row definitions so timeline rows match tag template vocabulary.
    templateState.tags.forEach((tag, index) => {
      const groupId = buildGroupId(tag.name || String(tag.id), usedGroupIds);
      groupDefs.push({
        id: groupId,
        content: escapeHtml(tag.name),
        order: index,
        className: "timeline-group-template",
      });

      const nameKey = normalizeKey(tag.name);
      if (nameKey) {
        keyToGroupId.set(nameKey, groupId);
      }
      const shortNameKey = normalizeKey(tag.shortName);
      if (shortNameKey) {
        keyToGroupId.set(shortNameKey, groupId);
      }
    });

    eventGroupById.clear();
    timelineEvents.forEach((eventData) => {
      const labelText = String(eventData.label ?? "").trim() || "Unlabeled";
      const labelKey = normalizeKey(labelText);
      let groupId = keyToGroupId.get(labelKey);

      // If label is not mapped to a template tag, create a dedicated row for that event label.
      if (!groupId) {
        groupId = buildGroupId(labelText, usedGroupIds);
        groupDefs.push({
          id: groupId,
          content: escapeHtml(labelText),
          order: groupDefs.length,
          className: "timeline-group-generated",
        });
        keyToGroupId.set(labelKey, groupId);
      }

      eventGroupById.set(eventData.id, groupId);
    });

    groups.clear();
    if (groupDefs.length > 0) {
      groups.add(groupDefs);
    }

    items.clear();
    if (timelineEvents.length > 0) {
      items.add(
        timelineEvents.map((eventData) => toTimelineItem(eventData, eventGroupById.get(eventData.id)))
      );
    }
  }

  function refreshTimelineFromModel() {
    const selectedBeforeRefresh = selectedId;
    rebuildTimelineData();
    if (selectedBeforeRefresh && eventsById.has(selectedBeforeRefresh)) {
      timeline.setSelection([selectedBeforeRefresh], { focus: false });
    }
  }

  async function loadTimelineJson() {
    try {
      const response = await fetch("./timeline.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Expected a JSON array.");
      }

      eventsById.clear();
      let skipped = 0;
      payload.forEach((raw, index) => {
        const eventData = normalizeEvent(raw, index);
        if (!eventData) {
          skipped += 1;
          return;
        }
        eventsById.set(eventData.id, eventData);
      });

      refreshTimelineFromModel();
      selectEventById(null, false);
      timeline.setWindow(secondsToDate(0), secondsToDate(getTimelineMaxSeconds()), {
        animation: false,
      });

      const rowCount = groups.getIds().length;
      const skipNote = skipped > 0 ? ` (${skipped} invalid skipped)` : "";
      setStatus(`Loaded ${eventsById.size} timeline events in ${rowCount} rows${skipNote}.`);
    } catch (error) {
      setStatus(`Failed to load timeline.json: ${error.message}`);
    }
  }

  function exportTimelineJson() {
    const ordered = Array.from(eventsById.values())
      .map((eventData) => ({
        id: eventData.id,
        start: Number(eventData.start.toFixed(3)),
        end: Number(eventData.end.toFixed(3)),
        label: eventData.label,
      }))
      .sort((a, b) => a.start - b.start);

    const blob = new Blob([JSON.stringify(ordered, null, 2)], {
      type: "application/json",
    });

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = "timeline.export.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setStatus(`Exported ${ordered.length} events to timeline.export.json.`);
  }

  function clearTemplateView(message = "No template loaded.") {
    templateState.tags = [];
    templateState.labels = [];
    templateState.tagsById = new Map();
    templateState.labelsById = new Map();
    clearActiveTemplateAction();
    elements.templateMeta.textContent = message;
    elements.templateCanvas.style.width = "100%";
    elements.templateCanvas.style.height = "120px";
    elements.templateCanvas.innerHTML = '<div class="template-canvas-empty">No layout preview</div>';
    elements.templateTags.innerHTML = "";
    elements.templateLabels.innerHTML = "";
    if (timeline) {
      refreshTimelineFromModel();
    }
  }

  function toRgbColor(tag) {
    const r = Number(tag["tag_template-colour_r"]);
    const g = Number(tag["tag_template-colour_g"]);
    const b = Number(tag["tag_template-colour_b"]);

    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return "rgb(120, 130, 140)";
    }

    return `rgb(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(
      0,
      Math.min(255, b)
    )})`;
  }

  function toCssColor(value, fallback) {
    const text = String(value ?? "").trim();
    if (!text) {
      return fallback;
    }
    return text;
  }

  function toTemplateItemLabel(item, tagsById, labelsById) {
    const type = Number(item["event-window-item-type"]);
    const typeId = Number(item["event-window-item-type-id"]);

    if (type === 1) {
      const tag = tagsById.get(typeId);
      return tag?.["tag_template-name"] ?? `Tag ${typeId}`;
    }

    if (type === 2) {
      const label = labelsById.get(typeId);
      return label?.["label_template-text"] ?? `Label ${typeId}`;
    }

    return `Item ${type}:${typeId}`;
  }

  function toTemplateItemAction(item, tagsById, labelsById) {
    const type = Number(item["event-window-item-type"]);
    const typeId = Number(item["event-window-item-type-id"]);
    const actionKey = `${type}:${typeId}`;

    if (type === 1) {
      const tag = tagsById.get(typeId);
      if (!tag) {
        return null;
      }
      const preRoll = Number(tag["tag_template-default_pre_roll_secs"]);
      const postRoll = Number(tag["tag_template-default_post_roll_secs"]);
      return {
        key: actionKey,
        label: String(tag["tag_template-name"] ?? `Tag ${typeId}`),
        preRoll: Number.isFinite(preRoll) && preRoll >= 0 ? preRoll : 0,
        postRoll: Number.isFinite(postRoll) && postRoll >= 0 ? postRoll : 1,
      };
    }

    if (type === 2) {
      const label = labelsById.get(typeId);
      if (!label) {
        return null;
      }
      return {
        key: actionKey,
        label: String(label["label_template-text"] ?? `Label ${typeId}`),
        preRoll: 0.5,
        postRoll: 0.5,
      };
    }

    return null;
  }

  function syncTemplateActionSelection() {
    const activeKey = templateState.activeActionKey;
    const nodes = elements.templateCanvas.querySelectorAll(".template-canvas-button-action");
    nodes.forEach((node) => {
      const isActive = activeKey && node.dataset.actionKey === activeKey;
      node.classList.toggle("template-canvas-button-active", Boolean(isActive));
      node.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function clearActiveTemplateAction() {
    templateState.activeActionKey = null;
    templateState.activeActionLabel = "";
    templateState.activeActionStartSeconds = null;
    templateState.activeActionData = null;
  }

  function startTemplateAction(action) {
    const maxSeconds = getTimelineMaxSeconds();
    const now = roundToTenth(Math.max(0, Math.min(getCurrentPlayerTime(), maxSeconds)));
    templateState.activeActionKey = action.key;
    templateState.activeActionLabel = action.label;
    templateState.activeActionStartSeconds = now;
    templateState.activeActionData = action;
    syncTemplateActionSelection();
    setStatus(`Tag selected: ${action.label} at ${formatClock(now, true)}. Click again to end.`);
  }

  function finalizeActiveTemplateAction(endSeconds = getCurrentPlayerTime()) {
    const action = templateState.activeActionData;
    if (!action?.label || !templateState.activeActionKey) {
      return false;
    }

    const maxSeconds = getTimelineMaxSeconds();
    const end = roundToTenth(Math.max(0, Math.min(Number(endSeconds) || 0, maxSeconds)));
    const startRaw = Number(templateState.activeActionStartSeconds);
    const start = Number.isFinite(startRaw) ? startRaw : end;
    createEventFromTemplateAction(action, start, end);
    clearActiveTemplateAction();
    syncTemplateActionSelection();
    return true;
  }

  function toggleTemplateAction(action) {
    if (!action?.key) {
      return;
    }

    if (templateState.activeActionKey === action.key) {
      finalizeActiveTemplateAction(getCurrentPlayerTime());
      return;
    }

    if (templateState.activeActionKey && templateState.activeActionData) {
      finalizeActiveTemplateAction(getCurrentPlayerTime());
    }

    startTemplateAction(action);
  }

  function renderTemplateCanvas(templateData, tags, labels) {
    const windowData = templateData["event-window"];
    const rawItems = Array.isArray(windowData?.["event-window-items"])
      ? windowData["event-window-items"]
      : [];

    const parsedItems = rawItems
      .map((item) => {
        const x = Number(item["event-window-item-x"]);
        const y = Number(item["event-window-item-y"]);
        const width = Number(item["event-window-item-width"]);
        const height = Number(item["event-window-item-height"]);
        const z = Number(item["event-window-item-z"]);

        if (![x, y, width, height].every(Number.isFinite)) {
          return null;
        }

        return {
          raw: item,
          x: Math.max(0, x),
          y: Math.max(0, y),
          width: Math.max(10, width),
          height: Math.max(10, height),
          z: Number.isFinite(z) ? z : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.z - b.z);

    const configuredWidth = Number(windowData?.["event-window-canvas_width"]);
    const configuredHeight = Number(windowData?.["event-window-canvas_height"]);
    const maxRight = parsedItems.reduce((acc, item) => Math.max(acc, item.x + item.width), 0);
    const maxBottom = parsedItems.reduce((acc, item) => Math.max(acc, item.y + item.height), 0);
    const canvasWidth =
      configuredWidth > 0 ? configuredWidth : Math.max(320, Math.ceil(maxRight + 20));
    const canvasHeight =
      configuredHeight > 0 ? configuredHeight : Math.max(180, Math.ceil(maxBottom + 20));

    elements.templateCanvas.style.width = `${canvasWidth}px`;
    elements.templateCanvas.style.height = `${canvasHeight}px`;
    elements.templateCanvas.innerHTML = "";

    if (parsedItems.length === 0) {
      elements.templateCanvas.innerHTML = '<div class="template-canvas-empty">No layout preview</div>';
      return;
    }

    const tagsById = new Map(tags.map((tag) => [Number(tag["tag_template-id"]), tag]));
    const labelsById = new Map(labels.map((label) => [Number(label["label_template-id"]), label]));

    parsedItems.forEach((item) => {
      const button = document.createElement("div");
      const raw = item.raw;
      const label = toTemplateItemLabel(raw, tagsById, labelsById);
      const action = toTemplateItemAction(raw, tagsById, labelsById);
      const backgroundColor = toCssColor(raw["event-window-item-button_background_colour"], "#303030");
      const textColor = toCssColor(raw["event-window-item-button_text_colour"], "#ffffff");
      const showBorder = Boolean(raw["event-window-item-button_show_border"]);
      const borderWidth = Number(raw["event-window-item-button_border_width"]);
      const borderColor = toCssColor(raw["event-window-item-button_border_colour"], "#202020");
      const opacity = Number(raw["event-window-item-opacity"]);
      const textSize = Number(raw["event-window-item-button_text_size"]);

      button.className = "template-canvas-button";
      button.textContent = label;
      button.title = label;
      button.style.left = `${item.x}px`;
      button.style.top = `${item.y}px`;
      button.style.width = `${item.width}px`;
      button.style.height = `${item.height}px`;
      button.style.zIndex = String(item.z);
      button.style.backgroundColor = backgroundColor;
      button.style.color = textColor;
      button.style.opacity = Number.isFinite(opacity) ? String(Math.max(0, Math.min(1, opacity))) : "1";
      button.style.borderStyle = "solid";
      button.style.borderWidth = showBorder && Number.isFinite(borderWidth) ? `${Math.max(1, borderWidth)}px` : "1px";
      button.style.borderColor = showBorder ? borderColor : "transparent";
      if (Number.isFinite(textSize) && textSize > 0) {
        button.style.fontSize = `${textSize}px`;
      }
      if (action) {
        button.classList.add("template-canvas-button-action");
        button.dataset.actionKey = action.key;
        button.addEventListener("click", () => {
          toggleTemplateAction(action);
        });
      }

      elements.templateCanvas.append(button);
    });

    syncTemplateActionSelection();
  }

  function renderTemplateItems(container, records, renderFn) {
    container.innerHTML = "";

    if (records.length === 0) {
      const item = document.createElement("div");
      item.className = "template-item";
      item.textContent = "None";
      container.append(item);
      return;
    }

    records.forEach((record) => {
      const item = document.createElement("div");
      item.className = "template-item";
      renderFn(item, record);
      container.append(item);
    });
  }

  function applyTemplateData(templateData, sourceLabel) {
    if (!templateData || typeof templateData !== "object") {
      throw new Error("Template must be a JSON object.");
    }

    const tags = Array.isArray(templateData.tags) ? templateData.tags : [];
    const labels = Array.isArray(templateData.labels) ? templateData.labels : [];
    const version = templateData["template-version"];
    templateState.tags = normalizeTemplateTags(tags);
    templateState.labels = labels;
    templateState.tagsById = new Map(tags.map((tag) => [Number(tag["tag_template-id"]), tag]));
    templateState.labelsById = new Map(
      labels.map((label) => [Number(label["label_template-id"]), label])
    );
    clearActiveTemplateAction();

    elements.templateMeta.textContent = `Source: ${sourceLabel} | version: ${
      version ?? "n/a"
    } | tags: ${tags.length} | labels: ${labels.length}`;

    renderTemplateCanvas(templateData, tags, labels);

    renderTemplateItems(elements.templateTags, tags, (item, tag) => {
      const name = tag["tag_template-name"] ?? "Unnamed";
      const shortName = tag["tag_template-short_name"] ?? "";
      const id = tag["tag_template-id"] ?? "n/a";
      const color = toRgbColor(tag);

      item.innerHTML = `<span class="color-chip" style="background:${color}"></span><strong>${escapeHtml(
        String(name)
      )}</strong> <small>#${escapeHtml(String(id))} ${escapeHtml(String(shortName))}</small>`;
    });

    renderTemplateItems(elements.templateLabels, labels, (item, label) => {
      const labelText = label["label_template-text"] ?? "";
      const labelId = label["label_template-id"] ?? "n/a";
      item.innerHTML = `<strong>${escapeHtml(String(labelText))}</strong> <small>#${escapeHtml(
        String(labelId)
      )}</small>`;
    });

    if (timeline) {
      refreshTimelineFromModel();
    }

    setStatus(`Template loaded from ${sourceLabel} (${tags.length} tags, ${labels.length} labels).`);
  }

  function mapAbsolutePathToServerPath(pathText) {
    const trimmed = String(pathText || "").trim();
    if (!trimmed) {
      return "";
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    const homePrefixMatch = trimmed.match(/^\/Users\/[^/]+(\/.*)?$/);
    if (homePrefixMatch) {
      return homePrefixMatch[1] || "/";
    }

    return trimmed;
  }

  async function loadTemplateFromPath(pathText) {
    const resolvedPath = mapAbsolutePathToServerPath(pathText);
    if (!resolvedPath) {
      setStatus("Template path is empty.");
      return;
    }

    try {
      const response = await fetch(encodeURI(resolvedPath), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      applyTemplateData(payload, resolvedPath);
    } catch (error) {
      setStatus(`Failed to load template from path: ${error.message}`);
      clearTemplateView("Template load failed.");
    }
  }

  async function loadTemplateFromFile(file) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      applyTemplateData(payload, file.name);
    } catch (error) {
      setStatus(`Failed to load template file: ${error.message}`);
      clearTemplateView("Template load failed.");
    }
  }

  function stopYouTubePolling() {
    if (playerState.youtubePollTimer) {
      window.clearInterval(playerState.youtubePollTimer);
      playerState.youtubePollTimer = null;
    }
  }

  function startYouTubePolling() {
    stopYouTubePolling();

    playerState.youtubePollTimer = window.setInterval(() => {
      if (playerState.mode !== "youtube") {
        return;
      }

      const duration = Number(playerState.youtubePlayer?.getDuration?.());
      if (Number.isFinite(duration) && duration > 0) {
        setTimelineMaxFromDuration(duration, false);
      }

      const currentTime = Number(playerState.youtubePlayer?.getCurrentTime?.());
      if (Number.isFinite(currentTime)) {
        updatePlayhead(currentTime);
      }
    }, 250);
  }

  function destroyYouTubePlayer() {
    stopYouTubePolling();

    if (playerState.youtubePlayer && typeof playerState.youtubePlayer.destroy === "function") {
      playerState.youtubePlayer.destroy();
    }

    playerState.youtubePlayer = null;
    elements.youtubePlayerHost.innerHTML = "";
  }

  function switchToHtml5Player() {
    playerState.mode = "html5";
    elements.youtubeWrap.classList.add("hidden");
    elements.video.classList.remove("hidden");
    destroyYouTubePlayer();
  }

  function switchToYouTubeMode() {
    playerState.mode = "youtube";
    elements.video.pause();
    elements.video.classList.add("hidden");
    elements.youtubeWrap.classList.remove("hidden");
  }

  function extractYouTubeId(input) {
    const text = String(input || "").trim();
    const directIdMatch = text.match(/^[A-Za-z0-9_-]{11}$/);
    if (directIdMatch) {
      return directIdMatch[0];
    }

    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();

      if (host === "youtu.be") {
        const candidate = url.pathname.split("/").filter(Boolean)[0] || "";
        return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }

      if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
        const vParam = url.searchParams.get("v");
        if (vParam && /^[A-Za-z0-9_-]{11}$/.test(vParam)) {
          return vParam;
        }

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
          const candidate = parts[1];
          return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
        }
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function ensureYouTubeApi() {
    if (window.YT && typeof window.YT.Player === "function") {
      return Promise.resolve();
    }

    if (playerState.youtubeApiPromise) {
      return playerState.youtubeApiPromise;
    }

    playerState.youtubeApiPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      const previousHandler = window.onYouTubeIframeAPIReady;

      const timeoutId = window.setTimeout(() => {
        reject(new Error("YouTube API load timeout."));
      }, 10000);

      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousHandler === "function") {
          previousHandler();
        }
        window.clearTimeout(timeoutId);
        resolve();
      };

      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Unable to load YouTube API script."));
        };
        document.head.append(script);
      }
    });

    return playerState.youtubeApiPromise;
  }

  async function loadYouTubeVideo(inputUrl) {
    const videoId = extractYouTubeId(inputUrl);
    if (!videoId) {
      setStatus("Invalid YouTube URL/ID. Paste a full YouTube link or 11-char video ID.");
      return;
    }

    try {
      await ensureYouTubeApi();
      destroyYouTubePlayer();
      switchToYouTubeMode();

      elements.youtubePlayerHost.innerHTML = "<div id=\"youtubePlayer\"></div>";

      playerState.youtubePlayer = new window.YT.Player("youtubePlayer", {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            setTimelineMaxFromDuration(playerState.youtubePlayer?.getDuration?.(), true);
            startYouTubePolling();
            updatePlayhead(0);
            setStatus(`YouTube loaded (${videoId}).`);
          },
          onError: (event) => {
            setStatus(`YouTube player error (${event.data}).`);
          },
        },
      });
    } catch (error) {
      setStatus(`Failed to load YouTube video: ${error.message}`);
    }
  }

  function releaseLocalObjectUrl() {
    if (playerState.localObjectUrl) {
      URL.revokeObjectURL(playerState.localObjectUrl);
      playerState.localObjectUrl = null;
    }
  }

  function loadDefaultProjectVideo() {
    releaseLocalObjectUrl();
    switchToHtml5Player();
    elements.video.src = "./video.mp4";
    elements.video.load();
    setStatus("Using ./video.mp4");
  }

  function loadLocalVideoFile(file) {
    if (!file) {
      return;
    }

    releaseLocalObjectUrl();
    switchToHtml5Player();

    const objectUrl = URL.createObjectURL(file);
    playerState.localObjectUrl = objectUrl;
    elements.video.src = objectUrl;
    elements.video.load();

    setStatus(`Loaded local video: ${file.name}`);
  }

  function bindUi() {
    elements.loadBtn.addEventListener("click", loadTimelineJson);
    elements.exportBtn.addEventListener("click", exportTimelineJson);

    elements.lockBtn.addEventListener("click", () => {
      isLocked = !isLocked;
      updateTimelineEditableState();
      setStatus(
        isLocked
          ? "Timeline locked: dragging/resizing disabled."
          : "Timeline unlocked: dragging/resizing enabled."
      );
    });

    elements.useDefaultVideoBtn.addEventListener("click", () => {
      loadDefaultProjectVideo();
    });

    elements.localVideoInput.addEventListener("change", () => {
      const file = elements.localVideoInput.files?.[0];
      loadLocalVideoFile(file);
      elements.localVideoInput.value = "";
    });

    elements.loadYoutubeBtn.addEventListener("click", () => {
      loadYouTubeVideo(elements.youtubeUrlInput.value);
    });

    elements.youtubeUrlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadYouTubeVideo(elements.youtubeUrlInput.value);
      }
    });

    elements.loadTemplatePathBtn.addEventListener("click", () => {
      loadTemplateFromPath(elements.templatePathInput.value);
    });

    elements.templatePathInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadTemplateFromPath(elements.templatePathInput.value);
      }
    });

    elements.templateFileInput.addEventListener("change", () => {
      const file = elements.templateFileInput.files?.[0];
      loadTemplateFromFile(file);
      elements.templateFileInput.value = "";
    });

    elements.selLabel.addEventListener("input", (event) => {
      if (!selectedId) {
        return;
      }

      const current = eventsById.get(selectedId);
      if (!current) {
        return;
      }

      current.label = event.target.value;
      refreshTimelineFromModel();
      selectEventById(current.id, false);
    });

    elements.video.addEventListener("timeupdate", () => {
      if (playerState.mode !== "html5") {
        return;
      }
      updatePlayhead(elements.video.currentTime || 0);
    });

    elements.video.addEventListener("loadedmetadata", () => {
      if (playerState.mode !== "html5") {
        return;
      }
      setTimelineMaxFromDuration(elements.video.duration, true);
      updatePlayhead(elements.video.currentTime || 0);
    });

    elements.video.addEventListener("error", () => {
      if (playerState.mode !== "html5") {
        return;
      }
      setStatus("Video source could not be loaded. Timeline/template features still work.");
    });

    window.addEventListener("beforeunload", () => {
      releaseLocalObjectUrl();
      destroyYouTubePlayer();
    });
  }

  function initTimeline() {
    items = new vis.DataSet();
    groups = new vis.DataSet();
    const maxSeconds = getTimelineMaxSeconds();
    const axisConfig = getAxisConfigForDuration(maxSeconds);

    timeline = new vis.Timeline(elements.timeline, items, groups, {
      stack: false,
      multiselect: false,
      selectable: true,
      showCurrentTime: false,
      showMajorLabels: false,
      orientation: { axis: "top", item: "bottom" },
      groupOrder: "order",
      groupHeightMode: "fixed",
      horizontalScroll: true,
      min: secondsToDate(0),
      max: secondsToDate(maxSeconds),
      start: secondsToDate(0),
      end: secondsToDate(maxSeconds),
      timeAxis: axisConfig,
      zoomMin: 500,
      zoomMax: maxSeconds * MS_PER_SECOND,
      margin: { item: { vertical: 6 }, axis: 6 },
      format: {
        minorLabels(date, scale) {
          return formatAxisLabel(date, scale);
        },
        majorLabels() {
          return "";
        },
      },
      snap(date) {
        const snappedMs = Math.round(date.valueOf() / 100) * 100;
        return new Date(snappedMs);
      },
      editable: {
        add: false,
        remove: false,
        updateGroup: false,
        updateTime: true,
      },
      onMove(item, callback) {
        if (isLocked) {
          callback(null);
          return;
        }

        const current = eventsById.get(String(item.id));
        if (!current) {
          callback(item);
          return;
        }

        const maxTimeline = getTimelineMaxSeconds();
        const updatedStart = roundToTenth(
          Math.max(0, Math.min(maxTimeline, dateToSeconds(item.start)))
        );
        const updatedEnd = Math.max(
          updatedStart,
          roundToTenth(Math.min(maxTimeline, dateToSeconds(item.end)))
        );

        current.start = updatedStart;
        current.end = updatedEnd;

        item.start = secondsToDate(current.start);
        item.end = secondsToDate(current.end);
        callback(item);

        if (selectedId === current.id) {
          setSelectionPanel(current);
        }
      },
    });

    timeline.addCustomTime(secondsToDate(0), "playhead");

    timeline.on("click", (properties) => {
      if (properties.item) {
        selectEventById(properties.item, true);
        return;
      }

      if (properties.time) {
        const target = Math.max(0, dateToSeconds(properties.time));
        seekPlayer(target);
      }

      // Keep current event highlighted until another event item is clicked.
      if (selectedId && eventsById.has(selectedId)) {
        timeline.setSelection([selectedId], { focus: false });
      }
    });
  }

  function init() {
    initTimeline();
    bindUi();

    updateTimelineEditableState();
    setSelectionPanel(null);
    clearTemplateView();

    loadTimelineJson();
    loadTemplateFromPath(elements.templatePathInput.value);
  }

  init();
})();
