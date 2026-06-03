import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPaginationSummary, getVisiblePageNumbers } from '../utils';

type PaginationProps = {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  totalRows: number;
  pageSizeOptions: number[];
  canPreviousPage: boolean;
  canNextPage: boolean;
  onPageIndexChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function Pagination({
  pageIndex,
  pageSize,
  pageCount,
  totalRows,
  pageSizeOptions,
  canPreviousPage,
  canNextPage,
  onPageIndexChange,
  onPageSizeChange,
}: PaginationProps) {
  const currentPage = pageIndex + 1;
  const pages = getVisiblePageNumbers(pageIndex, pageCount);
  const summary = getPaginationSummary({ pageIndex, pageSize, totalRows });

  return (
    <div className="dt-pagination">
      <label className="dt-page-size">
        <span>Mostrar</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <p className="dt-pagination-summary">
        Mostrando <strong>{summary.from}</strong> a{' '}
        <strong>{summary.to}</strong> de <strong>{summary.totalRows}</strong>
      </p>

      <div className="dt-pagination-pages">
        <button
          type="button"
          className="dt-page-button wide"
          onClick={() => onPageIndexChange(Math.max(0, pageIndex - 1))}
          disabled={!canPreviousPage}
        >
          <ChevronLeft size={15} />
          Previo
        </button>

        {pages.map((page) =>
          typeof page === 'number' ? (
            <button
              key={page}
              type="button"
              className={`dt-page-button ${currentPage === page ? 'active' : ''}`}
              aria-current={currentPage === page ? 'page' : undefined}
              onClick={() => onPageIndexChange(page - 1)}
            >
              {page}
            </button>
          ) : (
            <span key={page} className="dt-page-ellipsis">
              ...
            </span>
          ),
        )}

        <button
          type="button"
          className="dt-page-button wide"
          onClick={() =>
            onPageIndexChange(Math.min(pageCount - 1, pageIndex + 1))
          }
          disabled={!canNextPage}
        >
          Siguiente
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
