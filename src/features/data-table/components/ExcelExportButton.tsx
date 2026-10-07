import type { Table } from '@tanstack/react-table';
import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { saveBlob } from '../../../lib/download';
import {
  createExcelBlob,
  getExcelSnapshot,
  type ExcelExportOptions,
} from '../excelExport';

export function ExcelExportButton<TData>({
  table,
  options,
  disabled,
}: {
  table: Table<TData>;
  options: ExcelExportOptions<TData>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const hasRows = table.getPrePaginationRowModel().rows.length > 0;

  async function download() {
    if (inFlight.current || disabled || !hasRows) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // Snapshot before loading ExcelJS so later view changes cannot alter this export.
      const snapshot = getExcelSnapshot(table);
      const fileName =
        typeof options.fileName === 'function'
          ? options.fileName(
              table.getPrePaginationRowModel().rows.map((row) => row.original),
            )
          : options.fileName;
      const blob = await createExcelBlob(snapshot, options.sheetName);
      saveBlob(blob, fileName);
    } catch (error) {
      options.onError(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="dt-icon-button"
      title="Descargar Excel"
      aria-label="Descargar Excel"
      aria-busy={busy}
      disabled={disabled || busy || !hasRows}
      onClick={() => void download()}
    >
      {busy ? <LoaderCircle size={18} /> : <FileSpreadsheet size={18} />}
    </button>
  );
}
