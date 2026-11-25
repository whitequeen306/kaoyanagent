import { useState } from 'react';
import { pdfFileName, pickPdfDestination, savePdfElement } from '../lib/pdf';
import { request } from '../lib/api';
import type { Paper } from '../types';

export function usePdfExport(setError: (message: string) => void) {
  const [pdfPaper, setPdfPaper] = useState<Paper | null>(null);
  const [pdfChoiceOpen, setPdfChoiceOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfStage, setPdfStage] = useState<{ paper: Paper; includeAnswers: boolean } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState('');

  async function generatePaperPdf(paper: Paper, includeAnswers: boolean, fileHandle: any, fileName: string) {
    setPdfChoiceOpen(false);
    setPdfBusy(true);
    setPdfMessage('正在生成 PDF…');
    setPdfStage({ paper, includeAnswers });
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const element = document.getElementById('pdf-export-paper');
      if (!element) throw new Error('PDF 内容未就绪');
      const method = await savePdfElement(element, fileHandle, fileName);
      setPdfMessage(method === 'picker' ? 'PDF 已保存。' : '当前浏览器不支持选择保存位置，已下载到默认下载目录。');
      window.setTimeout(() => { setPdfBusy(false); setPdfStage(null); }, 900);
    } catch (e) {
      setPdfBusy(false);
      setPdfStage(null);
      setError(e instanceof Error ? `PDF 生成失败：${e.message}` : 'PDF 生成失败');
    }
  }

  async function savePaperPdf(paper: Paper, includeAnswers: boolean) {
    const fileName = pdfFileName(paper, includeAnswers);
    let fileHandle: any = null;
    try {
      fileHandle = await pickPdfDestination(fileName);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return;
      setError('无法打开保存位置选择器，已取消导出。');
      return;
    }
    await generatePaperPdf(paper, includeAnswers, fileHandle, fileName);
  }

  async function saveDraftPdfDirect(summary: any) {
    const fileName = pdfFileName({ ...summary, title: summary.title || '数学二练习卷' } as Paper, false);
    let fileHandle: any = null;
    try {
      fileHandle = await pickPdfDestination(fileName);
    } catch (e) {
      if ((e as any)?.name === 'AbortError') return;
      setError('无法打开保存位置选择器，已取消导出。');
      return;
    }
    setPdfLoading(true);
    try {
      const paper = await request<Paper>(`/api/papers/${summary.id}`);
      setPdfLoading(false);
      await generatePaperPdf(paper, false, fileHandle, fileName);
    } catch (e) {
      setPdfLoading(false);
      setError(e instanceof Error ? e.message : '读取试卷失败');
    }
  }

  async function openPdfOptions(id: string) {
    setPdfLoading(true); setError('');
    try {
      const data = await request<Paper>(`/api/papers/${id}`);
      setPdfPaper(data);
      setPdfChoiceOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : '读取试卷失败'); }
    finally { setPdfLoading(false); }
  }

  return {
    pdfPaper, pdfChoiceOpen, setPdfChoiceOpen, pdfLoading, pdfStage, pdfBusy, pdfMessage,
    openPdfOptions, savePaperPdf, saveDraftPdfDirect,
  };
}
