import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { SpreadsheetFile, Workbook } = await import(pathToFileURL('C:/Users/henrique/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs').href);

const root = 'C:/Users/henrique/projetos/google-flights-prototype';
const inputName = process.env.SCANNER_INPUT || 'price-scanner-80-90.json';
const outputName = process.env.SCANNER_OUTPUT || inputName.replace(/\.json$/i, '.xlsx');
const data = JSON.parse(await fs.readFile(`${root}/artifacts/${inputName}`, 'utf8'));
const outDir = `${root}/outputs`;
await fs.mkdir(outDir, { recursive: true });

const wb = Workbook.create();
const summary = wb.worksheets.add('Resumo');
summary.showGridLines = false;
summary.tabColor = '#1F4E78';
summary.getRange('A1:H1').values = [['Google Flights Price Graph', null, null, null, null, null, null, null]];
summary.getRange('A3:B7').values = [
  ['Data de ida inicial', data.search.departure_from],
  ['Data de ida final', data.search.departure_to],
  ['Duração inicial', data.search.duration_from],
  ['Duração final', data.search.duration_to],
  ['Fonte', 'Google Flights GetCalendarGraph']
];
summary.getRange('A9:F9').values = [['Duração', 'Datas únicas', 'Com preço', 'Sem preço', 'Avanços', 'Cobertura completa']];
const rows = Object.entries(data.durations).map(([duration, item]) => [
  Number(duration), item.totalUniqueDates, item.calendar.filter(x => x.price !== null).length,
  item.calendar.filter(x => x.price === null).length, item.deltas?.length ?? (item.windows.length - 1), item.confirms.targetComplete
]);
summary.getRange(`A10:F${9 + rows.length}`).values = rows;
summary.getRange('A1:H1').format = { font: { name: 'Arial', size: 14, bold: true, color: '#FFFFFF' }, fill: '#1F4E78' };
summary.getRange('A9:F9').format = { font: { name: 'Arial', bold: true, color: '#FFFFFF' }, fill: '#4472C4' };
summary.getRange('A3:F20').format.font = { name: 'Arial', size: 10 };
summary.getRange('B10:E20').format.numberFormat = '#,##0';
summary.getRange('A3:A7').format.font = { bold: true, color: '#404040' };
summary.getRange('A1:H20').format.verticalAlignment = 'center';
summary.getRange('A1:H20').format.autofitColumns();
summary.getRange('A1:H20').format.autofitRows();
summary.freezePanes.freezeRows(9);

for (const [duration, item] of Object.entries(data.durations)) {
  const sheet = wb.worksheets.add(`Duração ${duration}`);
  sheet.showGridLines = false;
  sheet.tabColor = '#5B9BD5';
  sheet.getRange('A1:F1').values = [['Price Graph', null, null, null, null, null]];
  sheet.getRange('A3:B6').values = [
    ['Duração (dias)', Number(duration)],
    ['Intervalo de ida', `${item.target.start} → ${item.target.end}`],
    ['Datas únicas', item.totalUniqueDates],
    ['Cobertura completa', item.confirms.targetComplete]
  ];
  sheet.getRange('A8:F8').values = [['Data de ida', 'Data de volta', 'Duração (dias)', 'Preço (€)', 'Estado', 'Dentro do intervalo']];
  const detail = (item.calendar || []).map(point => [
    point.departure_date, point.return_date, Number(duration), point.price,
    point.price === null ? 'Sem preço/voo' : 'Preço encontrado',
    point.departure_date >= data.search.departure_from && point.departure_date <= data.search.departure_to
  ]);
  if (detail.length) sheet.getRange(`A9:F${8 + detail.length}`).values = detail;
  sheet.getRange('A1:F1').format = { font: { name: 'Arial', size: 14, bold: true, color: '#FFFFFF' }, fill: '#1F4E78' };
  sheet.getRange('A8:F8').format = { font: { name: 'Arial', bold: true, color: '#FFFFFF' }, fill: '#4472C4' };
  sheet.getRange(`A1:F${8 + detail.length}`).format.font = { name: 'Arial', size: 10 };
  sheet.getRange(`D9:D${8 + detail.length}`).format.numberFormat = '€#,##0';
  sheet.getRange(`A1:F${8 + detail.length}`).format.verticalAlignment = 'center';
  sheet.getRange(`A1:F${8 + detail.length}`).format.autofitColumns();
  sheet.getRange(`A1:F${8 + detail.length}`).format.autofitRows();
  sheet.freezePanes.freezeRows(8);
  sheet.tables.add(`A8:F${8 + detail.length}`, true, `PriceGraph${duration}`);
}

wb.recalculate();
const check = await wb.inspect({ kind: 'table', sheetId: 'Resumo', range: 'A1:F12', include: 'values,formulas', tableMaxRows: 12, tableMaxCols: 6 });
console.log(check.ndjson);
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan' });
console.log(errors.ndjson);
const preview = await wb.render({ sheetName: 'Resumo', autoCrop: 'all', scale: 1, format: 'png' });
await fs.writeFile(`${outDir}/price-scanner-80-82-preview.png`, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(`${outDir}/${outputName}`);
console.log(`Saved ${outDir}/${outputName}`);
