import type { Paper } from '../types';

export function pdfFileName(paper: Paper, includeAnswers: boolean) {
  const title = (paper.title || '数学二练习卷').replace(/[\\/:*?"<>|]/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  return `${title}-${includeAnswers ? '带解析' : '空白卷'}-${date}.pdf`;
}

export async function pickPdfDestination(fileName: string) {
  if (typeof (window as any).showSaveFilePicker !== 'function') return null;
  return (window as any).showSaveFilePicker({
    suggestedName: fileName,
    startIn: 'desktop',
    types: [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }],
  });
}

export async function savePdfElement(element: HTMLElement, fileHandle: any, fileName: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  await document.fonts.ready;
  await Promise.all([...element.querySelectorAll('img')].map(image => image.complete
    ? Promise.resolve()
    : new Promise<void>(resolve => { image.addEventListener('load', () => resolve(), { once: true }); image.addEventListener('error', () => resolve(), { once: true }); })));
  await new Promise(resolve => setTimeout(resolve, 120));
  const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 12;
  const marginY = 12;
  const contentWidth = pageWidth - marginX * 2;
  const contentHeight = pageHeight - marginY * 2;
  const contentWidthPx = canvas.width * contentWidth / pageWidth;
  const contentHeightPx = contentWidthPx * contentHeight / contentWidth;
  const sourceX = (canvas.width - contentWidthPx) / 2;
  const elementRect = element.getBoundingClientRect();
  const pixelPerDom = canvas.height / Math.max(1, elementRect.height);
  const relativeTop = (node: HTMLElement) => (node.getBoundingClientRect().top - elementRect.top) * pixelPerDom;
  const relativeBottom = (node: HTMLElement) => (node.getBoundingClientRect().bottom - elementRect.top) * pixelPerDom;

  const questionNodes = [...element.querySelectorAll<HTMLElement>('.pdf-question')];
  const blocks = questionNodes.map(node => ({ top: relativeTop(node), bottom: relativeBottom(node) }));
  if (questionNodes.length) {
    const firstTop = blocks[0].top;
    if (firstTop > 0) blocks.unshift({ top: 0, bottom: firstTop });
  } else {
    blocks.push({ top: 0, bottom: canvas.height });
  }

  const pages: { top: number; bottom: number }[] = [];
  let pageTop = 0;
  let pageBottom = 0;
  for (const block of blocks) {
    if (block.bottom - pageTop > contentHeightPx && pageBottom > pageTop) {
      pages.push({ top: pageTop, bottom: pageBottom });
      pageTop = block.top;
      pageBottom = block.bottom;
    } else {
      pageBottom = Math.max(pageBottom, block.bottom);
    }
    while (pageBottom - pageTop > contentHeightPx) {
      pages.push({ top: pageTop, bottom: pageTop + contentHeightPx });
      pageTop += contentHeightPx;
    }
  }
  if (pageBottom > pageTop) pages.push({ top: pageTop, bottom: pageBottom });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  pages.forEach((page, index) => {
    const height = Math.max(1, Math.round(page.bottom - page.top));
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.round(contentWidthPx);
    pageCanvas.height = height;
    const context = pageCanvas.getContext('2d');
    if (!context) throw new Error('无法创建 PDF 画布');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(canvas, sourceX, page.top, contentWidthPx, height, 0, 0, pageCanvas.width, pageCanvas.height);
    if (index > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', marginX, marginY, contentWidth, height * contentWidth / contentWidthPx);
  });

  const blob = pdf.output('blob');
  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'picker';
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'download';
}
