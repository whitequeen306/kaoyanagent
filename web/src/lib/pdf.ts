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
  await new Promise(resolve => setTimeout(resolve, 120));
  const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const pageHeight = 297;
  const imageHeight = canvas.height * pageWidth / canvas.width;
  const image = canvas.toDataURL('image/jpeg', 0.95);
  let heightLeft = imageHeight;
  let position = 0;
  pdf.addImage(image, 'JPEG', 0, position, pageWidth, imageHeight);
  heightLeft -= pageHeight;
  while (heightLeft > 0) {
    position = heightLeft - imageHeight;
    pdf.addPage();
    pdf.addImage(image, 'JPEG', 0, position, pageWidth, imageHeight);
    heightLeft -= pageHeight;
  }
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
