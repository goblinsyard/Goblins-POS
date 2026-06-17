import * as XLSX from 'xlsx';

async function main() {
  const filePath = 'C:\\Users\\Tamer\\Downloads\\export_clients_260613 (1).xlsx';
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
  
  console.log('Row 0 (Header/empty):', rows[0]);
  console.log('Row 1 (Column headers):', rows[1]);
  console.log('Row 2 (First customer):', rows[2]);
}

main().catch(console.error);
