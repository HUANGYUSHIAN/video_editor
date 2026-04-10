import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  PauseIcon,
  PlayArrowIcon,
  SaveFolderIcon,
  SaveIcon,
} from './icons.jsx';
import { isMp4Extension, suggestedMp4Name, supportsDirectoryPicker, writeFileToDirectory } from './lib/browserFs.js';
import { exportSegmentsToMp4 } from './lib/ffmpegExport.js';
import { loadFfmpeg, terminateActiveFfmpeg } from './lib/loadFfmpeg.js';
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
    save: 'Save',
    language: 'Language',
    languageTitle: 'Choose Language',
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
    save: '存檔',
    language: '語言',
    languageTitle: '選擇語言',
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
    save: '保存',
    language: 'Language',
    languageTitle: '言語を選択',
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

  const exportAbortRef = useRef(null);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);
  const flagDragRef = useRef(null);

  const totalEdited = useMemo(() => editedDuration(segments), [segments]);

  useEffect(() => {
    if (!inputFile) {
      setFileUrl('');
      return;
    }
    const u = URL.createObjectURL(inputFile);
    setFileUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [inputFile]);

  const pickOutput = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      setSnack({ open: true, message: t(dict, 'browserNoFolder') });
      return false;
    }
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      setOutputDirHandle(h);
      setOutputDirLabel(h.name);
      return true;
    } catch (e) {
      if (e && typeof e === 'object' && 'name' in e && e.name === 'AbortError') return false;
      setSnack({ open: true, message: t(dict, 'openFolderFailed') });
      return false;
    }
  }, [dict]);

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
      if (!v || !segments.length) return;
      const src = editedToSource(segments, tEdited);
      if (Math.abs(v.currentTime - src) > 0.04) v.currentTime = src;
    },
    [segments],
  );

  useEffect(() => {
    syncVideoToEdited(editedTime);
  }, [editedTime, syncVideoToEdited]);

  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setEditedTime((prev) => {
        const next = prev + dt;
        if (totalEdited <= 0) return 0;
        if (next >= totalEdited) {
          setPlaying(false);
          return totalEdited;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [playing, totalEdited]);

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

  const openSaveDialog = async () => {
    if (!inputFile || !segments.length) {
      setSnack({ open: true, message: t(dict, 'loadFirst') });
      return;
    }
    if (!outputDirHandle) await pickOutput();
    setSaveFileName(suggestedMp4Name(inputFile));
    setSaveDialogOpen(true);
  };

  const exportMp4 = async () => {
    if (!inputFile || !outputDirHandle) {
      setSnack({ open: true, message: t(dict, 'pickSaveFolder') });
      return;
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
            <Tooltip title={t(dict, 'language')}><IconButton size="small" onClick={() => setLangDialogOpen(true)}><LanguageIcon /></IconButton></Tooltip>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inputFile ? inputFile.name : ''}{outputDirLabel ? ` → ${outputDirLabel}` : ''}
          </Typography>

          <Box sx={{ flex: 1, minWidth: 120, maxWidth: 420, ml: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {exporting ? (
              <>
                <Stack direction="row" justifyContent="flex-end"><Button size="small" color="inherit" onClick={cancelExport}>{t(dict, 'cancelSave')}</Button></Stack>
                <LinearProgress variant={exportPhase === 'encode' && encodeProgress != null ? 'determinate' : 'indeterminate'} value={encodeProgress ?? 0} sx={{ height: 8, borderRadius: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', lineHeight: 1.2, wordBreak: 'break-all' }}>
                  {exportPhase === 'load' && t(dict, 'loadEngine')}
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
              <video ref={videoRef} src={fileUrl} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} controls={false} onLoadedMetadata={onLoadedMetadata} onEnded={() => setPlaying(false)} />
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
            <Typography variant="caption">{t(dict, 'editedTimeline')} {formatHMS(editedTime)} / {formatHMS(totalEdited)}</Typography>
            <Typography variant="caption" color="text.secondary">{t(dict, 'sourceTimeline')} {formatHMS(currentSourceTime)} / {formatHMS(duration)}</Typography>
          </Stack>
          <Slider size="small" min={0} max={totalEdited > 0 ? totalEdited : 1} step={0.01} value={totalEdited > 0 ? Math.min(editedTime, totalEdited) : 0} onChange={(_, v) => { setEditedTime(Array.isArray(v) ? v[0] : v); setPlaying(false); }} disabled={!fileUrl || totalEdited <= 0} />
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
              <IconButton onClick={pickOutput} disabled={exporting}><SaveFolderIcon /></IconButton>
            </Stack>
            <TextField label={t(dict, 'saveName')} size="small" value={saveFileName} onChange={(e) => setSaveFileName(e.target.value)} helperText={t(dict, 'saveNameHint')} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)} disabled={exporting}>{t(dict, 'cancel')}</Button>
          <Button variant="contained" onClick={exportMp4} disabled={exporting || !outputDirHandle}>{t(dict, 'save')}</Button>
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
