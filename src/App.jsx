import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ContentCutIcon,
  DeleteOutsideIcon,
  DeleteSweepIcon,
  FlagIcon,
  FolderOpenIcon,
  LanguageIcon,
  AddIcon,
  MergeVideosIcon,
  VolumeIcon,
  PauseIcon,
  PlayArrowIcon,
  SaveFolderIcon,
  SaveIcon,
} from './icons.jsx';
import { isMp4Extension, suggestedMp4Name, supportsDirectoryPicker, writeFileToDirectory } from './lib/browserFs.js';
import { exportSegmentsToMp4 } from './lib/ffmpegExport.js';
import { mergeManyMp4CenterPad } from './lib/ffmpegMerge.js';
import { loadFfmpeg, terminateActiveFfmpeg } from './lib/loadFfmpeg.js';
import { getAllowedExportMaxEdges, scaledDimensionsLabel } from './lib/resolution.js';
import { normalizeVolumePercent, volumeGainFromPercent } from './lib/volume.js';
import {
  clampSourceToKept,
  editedDuration,
  editedToSource,
  sourceToEdited,
  subtractInterval,
} from './utils/segments.js';

const I18N = {
  en: {
    appInfo: 'MP4-only editor. Includes inclusive and exclusive deletion.',
    browserNoFolder: 'This browser does not support directory picker. Use Chrome/Edge.',
    openFolderFailed: 'Failed to open directory picker.',
    mp4Only: 'This version supports .mp4 only. Please convert your file first.',
    noRemain: 'No segment remains after deletion.',
    noKeep: 'No keepable content inside selected range.',
    loadFirst: 'Please load an MP4 and timeline first.',
    pickSaveFolder: 'Please select destination folder first.',
    saved: 'Saved:',
    cancelled: 'Save cancelled. You can continue editing and save again.',
    saveFailed: 'Save failed:',
    selectSource: 'Select Source MP4',
    selectOutput: 'Select Output Folder',
    play: 'Play',
    pause: 'Pause',
    trimStart: 'Trim Start',
    trimEnd: 'Trim End',
    inclusiveDelete: 'Inclusive Deletion: remove selected range',
    exclusiveDelete: 'Exclusive Deletion: keep selected range only',
    openSaveDialog: 'Open Save Dialog',
    cancelSave: 'Cancel Save',
    loadEngine: 'Loading encoder...',
    encoding: 'Encoding',
    writing: 'Writing file...',
    progressHint: 'Progress appears here while saving',
    chooseVideo: 'Choose an MP4 video file',
    history: 'Edit History',
    noHistory: 'No edit history',
    keep: 'Keep',
    remove: 'Remove',
    editedTimeline: 'Edited',
    sourceTimeline: 'Source',
    flagStart: 'Start Flag',
    flagEnd: 'End Flag',
    flagStartTitle: 'Trim Start',
    flagEndTitle: 'Trim End',
    timeInput: 'Time (sec / mm:ss / hh:mm:ss)',
    cancel: 'Cancel',
    apply: 'Apply',
    historyTitle: 'History Item',
    keepRange: 'Kept Range:',
    removedRange: 'Removed Range:',
    close: 'Close',
    revertEdit: 'Revert This Edit',
    saveSettings: 'Save Settings',
    savePath: 'Save Path',
    noFolderChosen: 'No folder selected',
    saveName: 'Save Name',
    saveNameHint: 'Default is source filename; .mp4 is auto-appended',
    exportResolution: 'Output resolution',
    exportResolutionOriginal: 'Original',
    exportResolutionHint:
      'Downscale only. Each number is the longest side (e.g. 1920×1080 → 1080 gives 1080×608). Same as source: pick Original. Soft subtitles: full unedited export only.',
    exportResolutionNoDownscale: 'Longest side is under 360px — only original resolution is available.',
    exportResolutionSameAsSource:
      'Selected size matches the source long edge; use Original for full resolution or pick a lower value.',
    save: 'Save',
    language: 'Language',
    languageTitle: 'Choose Language',
    mergeVideos: 'Merge two MP4 files',
    mergePickerTitle: 'Merge videos',
    selectVideoStep1: 'Select first video',
    selectVideoStep2: 'Select second video',
    selectVideoN: 'Select video',
    mergeAddVideo: 'Add video',
    mergeRun: 'Merge',
    mergeNeedsTwo: 'Please select at least 2 MP4 files.',
    mergeNeedsAll: 'Please select a file for every slot.',
    mergeExportTitle: 'Save merged file',
    mergeSaved: 'Merged file saved:',
    merging: 'Merging videos',
    mergeFailed: 'Merge failed:',
    volume: 'Volume',
    volumeTitle: 'Volume (0–200%)',
    volumeHint: 'Output = original × (value ÷ 100). 200 = 2×, 50 = half, 0 = mute.',
    volumeApply: 'Apply',
  },
  zh: {
    appInfo: '僅支援 MP4 編輯，含 inclusive / exclusive 刪除。',
    browserNoFolder: '此瀏覽器不支援資料夾選擇器，請使用 Chrome/Edge。',
    openFolderFailed: '開啟資料夾選擇器失敗。',
    mp4Only: '此版本僅支援 .mp4，請先轉檔後再載入。',
    noRemain: '刪除後沒有剩餘片段。',
    noKeep: '選取區間內沒有可保留片段。',
    loadFirst: '請先載入 MP4 並完成時間軸。',
    pickSaveFolder: '請先選擇存檔資料夾。',
    saved: '已存檔：',
    cancelled: '已取消存檔，可繼續編輯後再存。',
    saveFailed: '存檔失敗：',
    selectSource: '選擇來源 MP4',
    selectOutput: '選擇輸出資料夾',
    play: '播放',
    pause: '暫停',
    trimStart: '裁切起點',
    trimEnd: '裁切終點',
    inclusiveDelete: 'Inclusive 刪除：移除選取區間',
    exclusiveDelete: 'Exclusive 刪除：僅保留選取區間',
    openSaveDialog: '開啟存檔視窗',
    cancelSave: '取消存檔',
    loadEngine: '載入編碼器中...',
    encoding: '編碼中',
    writing: '寫入檔案中...',
    progressHint: '存檔時會在此顯示進度',
    chooseVideo: '請選擇 MP4 影片檔',
    history: '編輯歷史',
    noHistory: '尚無編輯紀錄',
    keep: '保留',
    remove: '刪除',
    editedTimeline: '編輯後',
    sourceTimeline: '來源',
    flagStart: '起點旗標',
    flagEnd: '終點旗標',
    flagStartTitle: '裁切起點',
    flagEndTitle: '裁切終點',
    timeInput: '時間（秒 / 分:秒 / 時:分:秒）',
    cancel: '取消',
    apply: '套用',
    historyTitle: '歷史紀錄',
    keepRange: '保留區間：',
    removedRange: '刪除區間：',
    close: '關閉',
    revertEdit: '復原此次編輯',
    saveSettings: '存檔設定',
    savePath: '存檔路徑',
    noFolderChosen: '尚未選擇資料夾',
    saveName: '存檔名稱',
    saveNameHint: '預設為原檔名，若未填 .mp4 會自動補上',
    exportResolution: '輸出解析度',
    exportResolutionOriginal: '原始',
    exportResolutionHint:
      '僅能縮小。數字代表長邊像素（例：1920×1080 選 1080 → 約 1080×608）。與來源相同請選「原始」。軟字幕僅未裁切且未縮放時保留。',
    exportResolutionNoDownscale: '來源長邊低於 360，僅能輸出原始解析度。',
    exportResolutionSameAsSource:
      '所選長邊與來源相同，請選「原始」維持全解析度，或改選較小數值。',
    save: '存檔',
    language: '語言',
    languageTitle: '選擇語言',
    mergeVideos: '合併兩個 MP4',
    mergePickerTitle: '合併影片',
    selectVideoStep1: '選擇第一部影片',
    selectVideoStep2: '選擇第二部影片',
    selectVideoN: '選擇影片',
    mergeAddVideo: '新增影片',
    mergeRun: '合併',
    mergeNeedsTwo: '請至少選擇 2 個 MP4 檔案。',
    mergeNeedsAll: '請為每一個欄位都選擇檔案。',
    mergeExportTitle: '儲存合併結果',
    mergeSaved: '合併檔已儲存：',
    merging: '合併影片中',
    mergeFailed: '合併失敗：',
    volume: '音量',
    volumeTitle: '音量（0–200%）',
    volumeHint: '輸出音量 = 原始 ×（數值 ÷ 100）。200 = 2 倍，50 = 一半，0 = 靜音。',
    volumeApply: '套用',
  },
  ja: {
    appInfo: 'MP4専用エディタ（inclusive / exclusive 削除対応）。',
    browserNoFolder: 'このブラウザはフォルダ選択に対応していません。Chrome/Edgeを使用してください。',
    openFolderFailed: 'フォルダ選択を開けませんでした。',
    mp4Only: 'このバージョンは .mp4 のみ対応です。先に変換してください。',
    noRemain: '削除後に残るセグメントがありません。',
    noKeep: '選択範囲内に保持できるセグメントがありません。',
    loadFirst: '先に MP4 を読み込み、タイムラインを作成してください。',
    pickSaveFolder: '先に保存先フォルダを選択してください。',
    saved: '保存しました：',
    cancelled: '保存をキャンセルしました。編集を続けて再保存できます。',
    saveFailed: '保存失敗：',
    selectSource: 'MP4を選択',
    selectOutput: '出力フォルダを選択',
    play: '再生',
    pause: '一時停止',
    trimStart: '開始点',
    trimEnd: '終了点',
    inclusiveDelete: 'Inclusive削除：選択範囲を削除',
    exclusiveDelete: 'Exclusive削除：選択範囲のみ保持',
    openSaveDialog: '保存ダイアログを開く',
    cancelSave: '保存をキャンセル',
    loadEngine: 'エンコーダーを読み込み中...',
    encoding: 'エンコード中',
    writing: '書き込み中...',
    progressHint: '保存中の進捗をここに表示',
    chooseVideo: 'MP4動画を選択してください',
    history: '編集履歴',
    noHistory: '履歴はありません',
    keep: '保持',
    remove: '削除',
    editedTimeline: '編集後',
    sourceTimeline: '元動画',
    flagStart: '開始フラグ',
    flagEnd: '終了フラグ',
    flagStartTitle: '開始点',
    flagEndTitle: '終了点',
    timeInput: '時間（秒 / 分:秒 / 時:分:秒）',
    cancel: 'キャンセル',
    apply: '適用',
    historyTitle: '履歴項目',
    keepRange: '保持範囲：',
    removedRange: '削除範囲：',
    close: '閉じる',
    revertEdit: 'この編集を元に戻す',
    saveSettings: '保存設定',
    savePath: '保存先',
    noFolderChosen: 'フォルダ未選択',
    saveName: '保存ファイル名',
    saveNameHint: '元ファイル名が既定。 .mp4 は自動付与',
    exportResolution: '出力解像度',
    exportResolutionOriginal: 'オリジナル',
    exportResolutionHint:
      '縮小のみ。数値は長辺のピクセル（例：1920×1080 で 1080 → 約 1080×608）。ソースと同じ場合は「オリジナル」。',
    exportResolutionNoDownscale: 'ソースの長辺が 360 未満のため、オリジナルのみ選択可能。',
    exportResolutionSameAsSource:
      '選択した長辺はソースと同じです。フル解像度は「オリジナル」、縮小はより小さい数値を選んでください。',
    save: '保存',
    language: 'Language',
    languageTitle: '言語を選択',
    mergeVideos: '2つの MP4 を結合',
    mergePickerTitle: '動画を結合',
    selectVideoStep1: '1本目の動画を選択',
    selectVideoStep2: '2本目の動画を選択',
    selectVideoN: '動画を選択',
    mergeAddVideo: '動画を追加',
    mergeRun: '結合',
    mergeNeedsTwo: '少なくとも 2 つの MP4 を選択してください。',
    mergeNeedsAll: 'すべての欄にファイルを選択してください。',
    mergeExportTitle: '結合ファイルの保存',
    mergeSaved: '結合ファイルを保存しました：',
    merging: '動画を結合中',
    mergeFailed: '結合失敗：',
    volume: '音量',
    volumeTitle: '音量（0–200%）',
    volumeHint: '出力 = 元の音量 ×（値 ÷ 100）。200 = 2倍、50 = 半分、0 = ミュート。',
    volumeApply: '適用',
  },
};

function t(dict, key) {
  return dict[key] || I18N.en[key] || key;
}

function intersectInterval(segments, a, b) {
  const out = [];
  for (const seg of segments) {
    const s = Math.max(seg.start, a);
    const e = Math.min(seg.end, b);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

function normalizeOutName(name, fallback) {
  const raw = (name || '').trim() || fallback || 'output';
  const base = raw.replace(/[\\/:*?"<>|]/g, '_');
  return /\.mp4$/i.test(base) ? base : `${base}.mp4`;
}

function formatHMS(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const rr = r.toFixed(2).padStart(5, '0');
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

function parseTimeInput(text, maxSec) {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n)) return Math.min(Math.max(0, n), maxSec);
  const parts = t.split(':').map((x) => x.trim());
  if (parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  if (parts.length === 2) return Math.min(Math.max(0, Number(parts[0]) * 60 + Number(parts[1])), maxSec);
  if (parts.length === 3) return Math.min(Math.max(0, Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])), maxSec);
  return null;
}

function createDefaultMergeSlots(count = 2) {
  return Array.from({ length: count }, () => ({ id: crypto.randomUUID(), file: null }));
}

function defaultMergeOutName(files) {
  const parts = files
    .map((f, i) => (f?.name || `clip${i + 1}`).replace(/\.[^.]+$/i, '') || `clip${i + 1}`)
    .slice(0, 4);
  let base = parts.join('_').replace(/[\\/:*?"<>|]/g, '_');
  if (files.length > 4) base += `_x${files.length}`;
  if (!base) base = 'merged';
  return /\.mp4$/i.test(base) ? base : `${base}.mp4`;
}

function mergeSlotLabel(dict, index) {
  if (index === 0) return t(dict, 'selectVideoStep1');
  if (index === 1) return t(dict, 'selectVideoStep2');
  return `${t(dict, 'selectVideoN')} ${index + 1}`;
}

/**
 * @param {File} file
 * @returns {Promise<{ width: number; height: number }>}
 */
function probeVideoDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
    };
    v.onloadedmetadata = () => {
      const width = v.videoWidth;
      const height = v.videoHeight;
      cleanup();
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new Error('Could not read video dimensions'));
    };
    v.onerror = () => {
      cleanup();
      reject(new Error('Could not load video metadata'));
    };
    v.src = url;
  });
}

export default function App() {
  const [lang, setLang] = useState('en');
  const dict = I18N[lang] || I18N.en;
  const [langDialogOpen, setLangDialogOpen] = useState(false);

  const [inputFile, setInputFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [outputDirHandle, setOutputDirHandle] = useState(null);
  const [outputDirLabel, setOutputDirLabel] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');
  const [sourceVideoHeight, setSourceVideoHeight] = useState(0);
  const [sourceVideoWidth, setSourceVideoWidth] = useState(0);
  const [exportResolution, setExportResolution] = useState('original');

  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState('idle');
  const [encodeProgress, setEncodeProgress] = useState(null);
  const [exportLog, setExportLog] = useState('');

  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState([]);
  const [history, setHistory] = useState([]);
  const [flagStart, setFlagStart] = useState(null);
  const [flagEnd, setFlagEnd] = useState(null);
  const [editedTime, setEditedTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [flagDialog, setFlagDialog] = useState(null);
  const [historyDialog, setHistoryDialog] = useState(null);
  const [flagTimeText, setFlagTimeText] = useState('');
  const [snack, setSnack] = useState({ open: false, message: '' });

  const [mergePickerOpen, setMergePickerOpen] = useState(false);
  const [mergeSlots, setMergeSlots] = useState(() => createDefaultMergeSlots(2));
  const [mergeSaveOpen, setMergeSaveOpen] = useState(false);
  const [mergeOutFileName, setMergeOutFileName] = useState('');

  const [volumePercent, setVolumePercent] = useState(100);
  const [volumeDialogOpen, setVolumeDialogOpen] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState('100');

  const exportAbortRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const flagDragRef = useRef(null);
  const playRafRef = useRef(null);
  const editedTimeRef = useRef(0);
  const sliderInputRef = useRef(null);
  const editedTimelineLabelRef = useRef(null);
  const sourceTimelineLabelRef = useRef(null);

  const totalEdited = useMemo(() => editedDuration(segments), [segments]);

  const allowedExportMaxEdges = useMemo(
    () => getAllowedExportMaxEdges(sourceVideoWidth, sourceVideoHeight),
    [sourceVideoWidth, sourceVideoHeight],
  );

  useEffect(() => {
    editedTimeRef.current = editedTime;
  }, [editedTime]);

  useEffect(() => {
    if (!inputFile) {
      setFileUrl('');
      return;
    }
    const u = URL.createObjectURL(inputFile);
    setFileUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [inputFile]);

  useEffect(() => {
    audioCtxRef.current = null;
    gainNodeRef.current = null;
  }, [inputFile]);

  const setupPlaybackAudio = useCallback((video) => {
    if (!video || gainNodeRef.current) return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
    } catch {
      audioCtxRef.current = null;
      gainNodeRef.current = null;
    }
  }, []);

  const applyPlaybackVolume = useCallback((percent) => {
    const p = normalizeVolumePercent(percent);
    const gain = volumeGainFromPercent(p);
    const v = videoRef.current;
    const gn = gainNodeRef.current;
    const ctx = audioCtxRef.current;

    if (gn && v) {
      gn.gain.value = gain;
      v.muted = p === 0;
      v.volume = 1;
      if (ctx?.state === 'suspended') void ctx.resume();
      return;
    }
    if (v) {
      v.muted = p === 0;
      v.volume = Math.min(1, gain);
    }
  }, []);

  useEffect(() => {
    applyPlaybackVolume(volumePercent);
  }, [volumePercent, applyPlaybackVolume, fileUrl]);

  const pickOutput = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      setSnack({ open: true, message: t(dict, 'browserNoFolder') });
      return null;
    }
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      setOutputDirHandle(h);
      setOutputDirLabel(h.name);
      return h;
    } catch (e) {
      if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') return null;
      setSnack({ open: true, message: t(dict, 'openFolderFailed') });
      return null;
    }
  }, [dict]);

  const videoSourceKey = inputFile ? `${inputFile.name}-${inputFile.lastModified}-${inputFile.size}` : 'empty';

  const resetEditState = () => {
    setPlaying(false);
    setSegments([]);
    setDuration(0);
    setEditedTime(0);
    setFlagStart(null);
    setFlagEnd(null);
    setHistory([]);
  };

  const pickInput = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,.mp4';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!isMp4Extension(f)) {
        setSnack({ open: true, message: t(dict, 'mp4Only') });
        return;
      }
      setInputFile(f);
      resetEditState();
    };
    input.click();
  };

  const syncVideoToEdited = useCallback(
    (tEdited) => {
      const v = videoRef.current;
      if (!v || !segments.length || v.readyState < 1) return;
      const src = editedToSource(segments, tEdited);
      if (Math.abs(v.currentTime - src) > 0.04) {
        try {
          v.currentTime = src;
        } catch {
          /* ignore seek before metadata */
        }
      }
    },
    [segments],
  );

  useEffect(() => {
    if (playing) return;
    syncVideoToEdited(editedTime);
  }, [editedTime, syncVideoToEdited, playing]);

  useEffect(() => {
    if (playing || !sliderInputRef.current || totalEdited <= 0) return;
    sliderInputRef.current.value = String(Math.min(editedTime, totalEdited));
  }, [editedTime, playing, totalEdited]);

  // Drive playback on the edited timeline (same mapping as the slider). Native
  // currentTime would otherwise advance through deleted source ranges and trip
  // "no segment" logic that stops at totalEdited.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playing || !segments.length || totalEdited <= 0) return;

    const startEdited = editedTimeRef.current;
    const startWall = performance.now();

    setupPlaybackAudio(v);
    applyPlaybackVolume(volumePercent);
    try {
      v.currentTime = editedToSource(segments, startEdited);
    } catch {
      /* ignore seek before metadata */
    }
    v.play().catch(() => {});

    const syncPlayheadUi = (tEdited) => {
      editedTimeRef.current = tEdited;
      const slider = sliderInputRef.current;
      if (slider) slider.value = String(tEdited);
      if (editedTimelineLabelRef.current) {
        editedTimelineLabelRef.current.textContent = `${t(dict, 'editedTimeline')} ${formatHMS(tEdited)} / ${formatHMS(totalEdited)}`;
      }
      if (sourceTimelineLabelRef.current) {
        const src = editedToSource(segments, tEdited);
        sourceTimelineLabelRef.current.textContent = `${t(dict, 'sourceTimeline')} ${formatHMS(src)} / ${formatHMS(duration)}`;
      }
    };

    const tick = () => {
      const elapsed = (performance.now() - startWall) / 1000;
      let tEdited = startEdited + elapsed;
      if (tEdited >= totalEdited) {
        tEdited = totalEdited;
        syncPlayheadUi(tEdited);
        setEditedTime(tEdited);
        setPlaying(false);
        return;
      }
      syncPlayheadUi(tEdited);
      const src = editedToSource(segments, tEdited);
      if (v.readyState >= 1 && Math.abs(v.currentTime - src) > 0.08) {
        try {
          v.currentTime = src;
        } catch {
          /* ignore */
        }
      }
      playRafRef.current = requestAnimationFrame(tick);
    };

    syncPlayheadUi(startEdited);
    playRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
      v.pause();
      setEditedTime(editedTimeRef.current);
    };
  }, [playing, segments, totalEdited, duration, dict, volumePercent, setupPlaybackAudio, applyPlaybackVolume]);

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) {
      setDuration(v.duration);
      setSegments([{ start: 0, end: v.duration }]);
      setEditedTime(0);
      setHistory([]);
      setFlagStart(null);
      setFlagEnd(null);
    }
  };

  const currentSourceTime = useMemo(() => editedToSource(segments, editedTime), [segments, editedTime]);

  const setTrimFlag = (which) => {
    if (!segments.length || !duration) return;
    const src = clampSourceToKept(segments, currentSourceTime, duration);
    if (which === 'start') setFlagStart(src);
    else setFlagEnd(src);
  };

  const pushHistory = (mode, a, b, before) => {
    setHistory((h) => [...h, { id: crypto.randomUUID(), mode, range: { start: a, end: b }, segmentsBefore: before, createdAt: Date.now() }]);
  };

  const applyInclusiveDelete = () => {
    if (flagStart == null || flagEnd == null) return;
    const a = Math.min(flagStart, flagEnd);
    const b = Math.max(flagStart, flagEnd);
    if (!(a < b)) return;
    const before = segments.map((s) => ({ ...s }));
    const next = subtractInterval(segments, a, b);
    if (next.length === 0) {
      setSnack({ open: true, message: t(dict, 'noRemain') });
      return;
    }
    const srcBefore = editedToSource(segments, editedTime);
    const srcAfter = clampSourceToKept(next, srcBefore, duration);
    pushHistory('inclusive', a, b, before);
    setSegments(next);
    setEditedTime(sourceToEdited(next, srcAfter));
    setFlagStart(null);
    setFlagEnd(null);
  };

  const applyExclusiveDelete = () => {
    if (flagStart == null || flagEnd == null) return;
    const a = Math.min(flagStart, flagEnd);
    const b = Math.max(flagStart, flagEnd);
    if (!(a < b)) return;
    const before = segments.map((s) => ({ ...s }));
    const keep = intersectInterval(segments, a, b);
    if (keep.length === 0) {
      setSnack({ open: true, message: t(dict, 'noKeep') });
      return;
    }
    const srcBefore = editedToSource(segments, editedTime);
    const srcAfter = clampSourceToKept(keep, srcBefore, duration);
    pushHistory('exclusive', a, b, before);
    setSegments(keep);
    setEditedTime(sourceToEdited(keep, srcAfter));
    setFlagStart(null);
    setFlagEnd(null);
  };

  const revertHistory = (entry) => {
    setSegments(entry.segmentsBefore.map((s) => ({ ...s })));
    setHistory((h) => {
      const idx = h.findIndex((x) => x.id === entry.id);
      return idx < 0 ? h : h.slice(0, idx);
    });
    setHistoryDialog(null);
  };

  const readSourceDimensions = useCallback(() => {
    const v = videoRef.current;
    if (v?.videoWidth > 0 && v.videoHeight > 0) {
      return { width: v.videoWidth, height: v.videoHeight };
    }
    return { width: sourceVideoWidth, height: sourceVideoHeight };
  }, [sourceVideoWidth, sourceVideoHeight]);

  const openSaveDialog = async () => {
    if (!inputFile || !segments.length) {
      setSnack({ open: true, message: t(dict, 'loadFirst') });
      return;
    }
    if (!outputDirHandle) {
      const h = await pickOutput();
      if (!h) return;
    }
    setSaveFileName(suggestedMp4Name(inputFile));
    setExportResolution('original');
    try {
      const dims = await probeVideoDimensions(inputFile);
      setSourceVideoHeight(dims.height);
      setSourceVideoWidth(dims.width);
    } catch {
      const live = readSourceDimensions();
      setSourceVideoHeight(live.height);
      setSourceVideoWidth(live.width);
    }
    setSaveDialogOpen(true);
  };

  const exportMp4 = async () => {
    if (!inputFile || !outputDirHandle) {
      setSnack({ open: true, message: t(dict, 'pickSaveFolder') });
      return;
    }

    const live = readSourceDimensions();
    let srcH = live.height;
    let srcW = live.width;
    if (srcH <= 0) {
      try {
        const dims = await probeVideoDimensions(inputFile);
        srcH = dims.height;
        srcW = dims.width;
      } catch {
        /* keep 0 */
      }
    }

    let resolutionForExport = exportResolution;
    if (resolutionForExport !== 'original') {
      const pickEdge = Math.round(Number(resolutionForExport));
      const srcMax = Math.max(srcW, srcH);
      if (srcMax > 0 && pickEdge >= srcMax) {
        setSnack({ open: true, message: t(dict, 'exportResolutionSameAsSource') });
        resolutionForExport = 'original';
      }
    }

    const outName = normalizeOutName(saveFileName, suggestedMp4Name(inputFile));
    exportAbortRef.current = new AbortController();
    const signal = exportAbortRef.current.signal;

    setExporting(true);
    setExportPhase('load');
    setEncodeProgress(null);
    setExportLog('');

    let ffmpeg;
    const onProg = ({ progress }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        setEncodeProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
      }
    };

    try {
      ffmpeg = await loadFfmpeg({ onLog: (m) => setExportLog(m.slice(-160)) });
      setExportPhase('encode');
      ffmpeg.on('progress', onProg);
      const data = await exportSegmentsToMp4(ffmpeg, inputFile, segments, {
        signal,
        sourceDuration: duration,
        sourceVideoHeight: srcH,
        sourceVideoWidth: srcW,
        exportResolution: resolutionForExport,
        volumePercent,
        onLog: (m) => setExportLog(m.slice(-160)),
        onProgress: (t) => setEncodeProgress(Math.round(t * 100)),
      });
      ffmpeg.off('progress', onProg);
      setExportPhase('write');
      setEncodeProgress(100);
      await writeFileToDirectory(outputDirHandle, outName, data, { signal });
      setSnack({ open: true, message: `${t(dict, 'saved')} ${outName}` });
      setSaveDialogOpen(false);
    } catch (err) {
      if (ffmpeg) {
        try {
          ffmpeg.off('progress', onProg);
        } catch {
          /* ignore */
        }
      }
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      if (aborted) {
        await terminateActiveFfmpeg();
        setSnack({ open: true, message: t(dict, 'cancelled') });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setSnack({ open: true, message: `${t(dict, 'saveFailed')} ${msg}` });
      }
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
      setExportPhase('idle');
      setEncodeProgress(null);
      setExportLog('');
    }
  };

  const cancelExport = async () => {
    exportAbortRef.current?.abort();
    await terminateActiveFfmpeg();
  };

  const openMergePicker = () => {
    if (exporting) return;
    setMergeSlots(createDefaultMergeSlots(2));
    setMergePickerOpen(true);
  };

  const pickMergeFile = (index) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,.mp4';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!isMp4Extension(f)) {
        setSnack({ open: true, message: t(dict, 'mp4Only') });
        return;
      }
      setMergeSlots((slots) => slots.map((s, i) => (i === index ? { ...s, file: f } : s)));
    };
    input.click();
  };

  const addMergeSlot = () => {
    setMergeSlots((slots) => [...slots, { id: crypto.randomUUID(), file: null }]);
  };

  const getMergeFiles = () => mergeSlots.map((s) => s.file).filter(Boolean);

  const goMergeSaveStep = async () => {
    const files = getMergeFiles();
    if (files.length < 2) {
      setSnack({ open: true, message: t(dict, 'mergeNeedsTwo') });
      return;
    }
    if (files.length !== mergeSlots.length) {
      setSnack({ open: true, message: t(dict, 'mergeNeedsAll') });
      return;
    }
    setMergePickerOpen(false);
    setMergeOutFileName(defaultMergeOutName(files));
    if (!outputDirHandle) {
      const h = await pickOutput();
      if (!h) {
        setMergePickerOpen(true);
        return;
      }
    }
    setMergeSaveOpen(true);
  };

  const exportMergedMp4 = async () => {
    const files = getMergeFiles();
    if (!outputDirHandle) {
      setSnack({ open: true, message: t(dict, 'pickSaveFolder') });
      return;
    }
    if (files.length < 2) {
      setSnack({ open: true, message: t(dict, 'mergeNeedsTwo') });
      return;
    }
    if (files.length !== mergeSlots.length) {
      setSnack({ open: true, message: t(dict, 'mergeNeedsAll') });
      return;
    }
    const outName = normalizeOutName(mergeOutFileName, defaultMergeOutName(files));
    exportAbortRef.current = new AbortController();
    const signal = exportAbortRef.current.signal;

    setExporting(true);
    setExportPhase('merge');
    setEncodeProgress(null);
    setExportLog('');

    let ffmpeg;
    const onProg = ({ progress }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        setEncodeProgress(Math.min(100, Math.max(0, Math.round(progress * 100))));
      }
    };

    try {
      const dims = await Promise.all(files.map((f) => probeVideoDimensions(f)));
      const canvas = {
        width: Math.max(...dims.map((d) => d.width)),
        height: Math.max(...dims.map((d) => d.height)),
      };

      ffmpeg = await loadFfmpeg({ onLog: (m) => setExportLog(m.slice(-160)) });
      ffmpeg.on('progress', onProg);
      const data = await mergeManyMp4CenterPad(ffmpeg, files, canvas, {
        signal,
        onLog: (m) => setExportLog(m.slice(-160)),
        onProgress: (p) => setEncodeProgress(Math.round(p * 100)),
      });
      ffmpeg.off('progress', onProg);
      setExportPhase('write');
      setEncodeProgress(100);
      await writeFileToDirectory(outputDirHandle, outName, data, { signal });
      setSnack({ open: true, message: `${t(dict, 'mergeSaved')} ${outName}` });
      setMergeSaveOpen(false);
      setMergeSlots(createDefaultMergeSlots(2));
    } catch (err) {
      if (ffmpeg) {
        try {
          ffmpeg.off('progress', onProg);
        } catch {
          /* ignore */
        }
      }
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      if (aborted) {
        await terminateActiveFfmpeg();
        setSnack({ open: true, message: t(dict, 'cancelled') });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setSnack({ open: true, message: `${t(dict, 'mergeFailed')} ${msg}` });
      }
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
      setExportPhase('idle');
      setEncodeProgress(null);
      setExportLog('');
    }
  };

  const openFlagDialog = (which) => {
    const src = which === 'start' ? flagStart : flagEnd;
    if (src == null) return;
    setFlagDialog(which);
    setFlagTimeText(String(src.toFixed(3)));
  };

  const saveFlagDialogTime = () => {
    const parsed = parseTimeInput(flagTimeText, duration || 0);
    if (parsed == null) return;
    const clamped = clampSourceToKept(segments, parsed, duration || 0);
    if (flagDialog === 'start') setFlagStart(clamped);
    if (flagDialog === 'end') setFlagEnd(clamped);
    setEditedTime(sourceToEdited(segments, clamped));
    setFlagDialog(null);
  };

  const editedFromClientX = (clientX) => {
    const el = trackRef.current;
    if (!el || totalEdited <= 0) return 0;
    const r = el.getBoundingClientRect();
    const p = (clientX - r.left) / r.width;
    return Math.min(Math.max(0, p * totalEdited), totalEdited);
  };

  const onFlagPointerDown = (which) => (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    flagDragRef.current = { which, x: e.clientX, dragging: false };
    setPlaying(false);
  };

  const onFlagPointerMove = (which) => (e) => {
    const d = flagDragRef.current;
    if (!d || d.which !== which) return;
    if (!d.dragging && Math.abs(e.clientX - d.x) > 4) d.dragging = true;
    if (!d.dragging) return;
    const src = editedToSource(segments, editedFromClientX(e.clientX));
    const clamped = clampSourceToKept(segments, src, duration || 0);
    if (which === 'start') setFlagStart(clamped);
    else setFlagEnd(clamped);
    setEditedTime(sourceToEdited(segments, clamped));
  };

  const onFlagPointerUp = (which) => (e) => {
    const d = flagDragRef.current;
    flagDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d || d.which !== which) return;
    if (!d.dragging) openFlagDialog(which);
  };

  const flagLeftPct = (src) => (src == null || totalEdited <= 0 ? null : (sourceToEdited(segments, src) / totalEdited) * 100);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Alert severity="info" sx={{ borderRadius: 0 }}>{t(dict, 'appInfo')}</Alert>

      <Paper elevation={0} square sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%', flexWrap: 'nowrap' }}>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
            <Tooltip title={t(dict, 'selectSource')}><IconButton color={inputFile ? 'primary' : 'default'} onClick={pickInput} size="small" disabled={exporting}><FolderOpenIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'selectOutput')}><IconButton color={outputDirHandle ? 'secondary' : 'default'} onClick={pickOutput} size="small" disabled={exporting}><SaveFolderIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'play')}><IconButton size="small" onClick={() => setPlaying(true)} disabled={!fileUrl || totalEdited <= 0}><PlayArrowIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'pause')}><IconButton size="small" onClick={() => setPlaying(false)}><PauseIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'trimStart')}><IconButton size="small" onClick={() => setTrimFlag('start')} disabled={!segments.length}><ContentCutIcon sx={{ transform: 'scaleX(-1)' }} /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'trimEnd')}><IconButton size="small" onClick={() => setTrimFlag('end')} disabled={!segments.length}><ContentCutIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'inclusiveDelete')}><IconButton size="small" color="error" onClick={applyInclusiveDelete} disabled={flagStart == null || flagEnd == null}><DeleteSweepIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'exclusiveDelete')}><IconButton size="small" color="warning" onClick={applyExclusiveDelete} disabled={flagStart == null || flagEnd == null}><DeleteOutsideIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'openSaveDialog')}><IconButton size="small" color="primary" onClick={openSaveDialog} disabled={exporting || !inputFile || !segments.length}><SaveIcon /></IconButton></Tooltip>
            <Tooltip title={t(dict, 'mergeVideos')}><IconButton size="small" color="secondary" onClick={openMergePicker} disabled={exporting}><MergeVideosIcon /></IconButton></Tooltip>
            <Tooltip title={`${t(dict, 'volume')}: ${volumePercent}%`}>
              <IconButton
                size="small"
                onClick={() => {
                  setVolumeDraft(String(volumePercent));
                  setVolumeDialogOpen(true);
                }}
                disabled={exporting}
                color={volumePercent === 0 ? 'default' : volumePercent === 100 ? 'default' : 'primary'}
              >
                <VolumeIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t(dict, 'language')}><IconButton size="small" onClick={() => setLangDialogOpen(true)}><LanguageIcon /></IconButton></Tooltip>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inputFile ? inputFile.name : ''}{outputDirLabel ? ` → ${outputDirLabel}` : ''}
          </Typography>

          <Box sx={{ flex: 1, minWidth: 120, maxWidth: 420, ml: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {exporting ? (
              <>
                <Stack direction="row" justifyContent="flex-end"><Button size="small" color="inherit" onClick={cancelExport}>{t(dict, 'cancelSave')}</Button></Stack>
                <LinearProgress variant={(exportPhase === 'encode' || exportPhase === 'merge') && encodeProgress != null ? 'determinate' : 'indeterminate'} value={encodeProgress ?? 0} sx={{ height: 8, borderRadius: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', lineHeight: 1.2, wordBreak: 'break-all' }}>
                  {exportPhase === 'load' && t(dict, 'loadEngine')}
                  {exportPhase === 'merge' && (encodeProgress != null ? `${t(dict, 'merging')} ${encodeProgress}%` : t(dict, 'merging'))}
                  {exportPhase === 'encode' && (encodeProgress != null ? `${t(dict, 'encoding')} ${encodeProgress}%` : t(dict, 'encoding'))}
                  {exportPhase === 'write' && t(dict, 'writing')}
                  {exportLog ? ` · ${exportLog}` : ''}
                </Typography>
              </>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', opacity: 0.6 }}>{t(dict, 'progressHint')}</Typography>
            )}
          </Box>
        </Stack>
      </Paper>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Box sx={{ flex: 1, minWidth: 0, p: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#0b0b0b' }}>
          <Paper elevation={4} sx={{ width: '100%', height: '100%', bgcolor: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {fileUrl ? (
              <video
                key={videoSourceKey}
                ref={videoRef}
                src={fileUrl}
                preload="auto"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                controls={false}
                playsInline
                onLoadedMetadata={onLoadedMetadata}
                onEnded={() => setPlaying(false)}
              />
            ) : (
              <Typography color="grey.500">{t(dict, 'chooseVideo')}</Typography>
            )}
          </Paper>
        </Box>

        <Paper square elevation={0} sx={{ width: 240, borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Typography variant="subtitle2" sx={{ px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>{t(dict, 'history')}</Typography>
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {history.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>{t(dict, 'noHistory')}</Typography>
            ) : (
              <List dense disablePadding>
                {[...history].reverse().map((h) => (
                  <ListItemButton key={h.id} onClick={() => setHistoryDialog(h)}>
                    <ListItemText
                      primary={`${h.mode === 'exclusive' ? t(dict, 'keep') : t(dict, 'remove')} ${formatHMS(h.range.start)} — ${formatHMS(h.range.end)}`}
                      secondary={new Date(h.createdAt).toLocaleString()}
                      primaryTypographyProps={{ variant: 'body2' }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        </Paper>
      </Box>

      <Paper square elevation={3} sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={2}>
            <Typography ref={editedTimelineLabelRef} variant="caption">
              {t(dict, 'editedTimeline')}{' '}
              {playing ? '' : `${formatHMS(editedTime)} / ${formatHMS(totalEdited)}`}
            </Typography>
            <Typography ref={sourceTimelineLabelRef} variant="caption" color="text.secondary">
              {t(dict, 'sourceTimeline')}{' '}
              {playing ? '' : `${formatHMS(currentSourceTime)} / ${formatHMS(duration)}`}
            </Typography>
          </Stack>
          <Box
            component="input"
            ref={sliderInputRef}
            type="range"
            min={0}
            max={totalEdited > 0 ? totalEdited : 1}
            step={0.01}
            defaultValue={0}
            disabled={!fileUrl || totalEdited <= 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              setEditedTime(v);
              setPlaying(false);
            }}
            sx={{
              width: '100%',
              height: 28,
              p: 0,
              cursor: !fileUrl || totalEdited <= 0 ? 'default' : 'pointer',
              accentColor: 'primary.main',
            }}
          />
          <Box sx={{ position: 'relative', height: 36 }} ref={trackRef}>
            <Box sx={{ position: 'absolute', left: 0, right: 0, top: 10, height: 10, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }} />
            {flagLeftPct(flagStart) != null && <Tooltip title={t(dict, 'flagStart')}><Box onPointerDown={onFlagPointerDown('start')} onPointerMove={onFlagPointerMove('start')} onPointerUp={onFlagPointerUp('start')} onPointerCancel={onFlagPointerUp('start')} sx={{ position: 'absolute', left: `${flagLeftPct(flagStart)}%`, top: 2, transform: 'translateX(-50%)', cursor: 'grab', color: 'success.main', touchAction: 'none' }}><FlagIcon fontSize="small" /></Box></Tooltip>}
            {flagLeftPct(flagEnd) != null && <Tooltip title={t(dict, 'flagEnd')}><Box onPointerDown={onFlagPointerDown('end')} onPointerMove={onFlagPointerMove('end')} onPointerUp={onFlagPointerUp('end')} onPointerCancel={onFlagPointerUp('end')} sx={{ position: 'absolute', left: `${flagLeftPct(flagEnd)}%`, top: 2, transform: 'translateX(-50%)', cursor: 'grab', color: 'error.main', touchAction: 'none' }}><FlagIcon fontSize="small" /></Box></Tooltip>}
          </Box>
        </Stack>
      </Paper>

      <Dialog open={Boolean(flagDialog)} onClose={() => setFlagDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{flagDialog === 'start' ? t(dict, 'flagStartTitle') : t(dict, 'flagEndTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={t(dict, 'timeInput')} value={flagTimeText} onChange={(e) => setFlagTimeText(e.target.value)} fullWidth size="small" />
            {fileUrl && <FlagPreviewVideo fileUrl={fileUrl} sourceTime={flagDialog === 'start' ? flagStart : flagEnd} />}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setFlagDialog(null)}>{t(dict, 'cancel')}</Button><Button variant="contained" onClick={saveFlagDialogTime}>{t(dict, 'apply')}</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(historyDialog)} onClose={() => setHistoryDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t(dict, 'historyTitle')}</DialogTitle>
        <DialogContent>
          {historyDialog && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">{historyDialog.mode === 'exclusive' ? t(dict, 'keepRange') : t(dict, 'removedRange')}{formatHMS(historyDialog.range.start)} — {formatHMS(historyDialog.range.end)}</Typography>
              {fileUrl && <FlagPreviewVideo fileUrl={fileUrl} sourceTime={historyDialog.range.start} />}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryDialog(null)}>{t(dict, 'close')}</Button>
          {historyDialog && <Button color="warning" variant="contained" onClick={() => revertHistory(historyDialog)}>{t(dict, 'revertEdit')}</Button>}
        </DialogActions>
      </Dialog>

      <Dialog open={saveDialogOpen} onClose={() => !exporting && setSaveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t(dict, 'saveSettings')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField label={t(dict, 'savePath')} size="small" value={outputDirLabel || t(dict, 'noFolderChosen')} fullWidth InputProps={{ readOnly: true }} />
              <IconButton onClick={() => { void pickOutput(); }} disabled={exporting}><SaveFolderIcon /></IconButton>
            </Stack>
            <TextField label={t(dict, 'saveName')} size="small" value={saveFileName} onChange={(e) => setSaveFileName(e.target.value)} helperText={t(dict, 'saveNameHint')} fullWidth />
            <FormControl fullWidth size="small" disabled={exporting}>
              <InputLabel id="export-resolution-label">{t(dict, 'exportResolution')}</InputLabel>
              <Select
                labelId="export-resolution-label"
                label={t(dict, 'exportResolution')}
                value={exportResolution}
                onChange={(e) => setExportResolution(e.target.value)}
              >
                <MenuItem value="original">
                  {sourceVideoHeight > 0
                    ? `${t(dict, 'exportResolutionOriginal')} (${sourceVideoWidth}×${sourceVideoHeight})`
                    : t(dict, 'exportResolutionOriginal')}
                </MenuItem>
                {allowedExportMaxEdges.map((edge) => (
                  <MenuItem key={edge} value={String(edge)}>
                    {edge} ({scaledDimensionsLabel(edge, sourceVideoWidth, sourceVideoHeight)})
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {allowedExportMaxEdges.length === 0
                  ? t(dict, 'exportResolutionNoDownscale')
                  : t(dict, 'exportResolutionHint')}
              </Typography>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)} disabled={exporting}>{t(dict, 'cancel')}</Button>
          <Button variant="contained" onClick={exportMp4} disabled={exporting || !outputDirHandle}>{t(dict, 'save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mergePickerOpen} onClose={() => !exporting && setMergePickerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t(dict, 'mergePickerTitle')}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ maxHeight: 360, overflowY: 'auto', px: 2, py: 1.5 }}>
            <Stack spacing={2}>
              {mergeSlots.map((slot, index) => (
                <Stack key={slot.id} spacing={0.5}>
                  <Button variant="outlined" fullWidth onClick={() => pickMergeFile(index)} disabled={exporting}>
                    {mergeSlotLabel(dict, index)}
                  </Button>
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                    {slot.file ? slot.file.name : '—'}
                  </Typography>
                </Stack>
              ))}
              <Button
                variant="outlined"
                fullWidth
                startIcon={<AddIcon />}
                onClick={addMergeSlot}
                disabled={exporting}
              >
                {t(dict, 'mergeAddVideo')}
              </Button>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergePickerOpen(false)} disabled={exporting}>{t(dict, 'cancel')}</Button>
          <Button variant="contained" onClick={() => { void goMergeSaveStep(); }} disabled={exporting}>{t(dict, 'mergeRun')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mergeSaveOpen} onClose={() => !exporting && setMergeSaveOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t(dict, 'mergeExportTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField label={t(dict, 'savePath')} size="small" value={outputDirLabel || t(dict, 'noFolderChosen')} fullWidth InputProps={{ readOnly: true }} />
              <IconButton onClick={() => { void pickOutput(); }} disabled={exporting}><SaveFolderIcon /></IconButton>
            </Stack>
            <TextField label={t(dict, 'saveName')} size="small" value={mergeOutFileName} onChange={(e) => setMergeOutFileName(e.target.value)} helperText={t(dict, 'saveNameHint')} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeSaveOpen(false)} disabled={exporting}>{t(dict, 'cancel')}</Button>
          <Button variant="contained" onClick={() => { void exportMergedMp4(); }} disabled={exporting || !outputDirHandle}>{t(dict, 'save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={volumeDialogOpen} onClose={() => setVolumeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t(dict, 'volumeTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t(dict, 'volume')}
              type="number"
              size="small"
              fullWidth
              inputProps={{ min: 0, max: 200, step: 1 }}
              value={volumeDraft}
              onChange={(e) => setVolumeDraft(e.target.value)}
              helperText={t(dict, 'volumeHint')}
            />
            <Slider
              size="small"
              min={0}
              max={200}
              step={1}
              value={Math.min(200, Math.max(0, Number(volumeDraft) || 0))}
              onChange={(_, v) => setVolumeDraft(String(Array.isArray(v) ? v[0] : v))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVolumeDialogOpen(false)}>{t(dict, 'cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              const p = normalizeVolumePercent(volumeDraft);
              setVolumePercent(p);
              setVolumeDraft(String(p));
              setVolumeDialogOpen(false);
            }}
          >
            {t(dict, 'volumeApply')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={langDialogOpen} onClose={() => setLangDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t(dict, 'languageTitle')}</DialogTitle>
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button variant={lang === 'en' ? 'contained' : 'outlined'} onClick={() => { setLang('en'); setLangDialogOpen(false); }}>English</Button>
          <Button variant={lang === 'zh' ? 'contained' : 'outlined'} onClick={() => { setLang('zh'); setLangDialogOpen(false); }}>繁體中文</Button>
          <Button variant={lang === 'ja' ? 'contained' : 'outlined'} onClick={() => { setLang('ja'); setLangDialogOpen(false); }}>日本語</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={5000} onClose={() => setSnack((s) => ({ ...s, open: false }))} message={snack.message} />
    </Box>
  );
}

function FlagPreviewVideo({ fileUrl, sourceTime }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || sourceTime == null || !Number.isFinite(sourceTime)) return;
    const onSeeked = () => {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
    };
    v.addEventListener('seeked', onSeeked);
    v.currentTime = Math.max(0, sourceTime);
    return () => v.removeEventListener('seeked', onSeeked);
  }, [sourceTime, fileUrl]);

  return (
    <Box sx={{ bgcolor: 'black', borderRadius: 1, overflow: 'hidden' }}>
      <video ref={ref} src={fileUrl} style={{ width: '100%', maxHeight: 220, display: 'block' }} muted playsInline />
    </Box>
  );
}
