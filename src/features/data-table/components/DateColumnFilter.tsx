import { CalendarDays } from 'lucide-react';
import { useId } from 'react';
import { DateRangeFilter } from '../../../lib/ui/DateRangeFilter';
import {
  normalizeDateFilter,
  type DateFilterValue,
  type DatePresenceLabels,
} from '../dateFilter';

type Props = {
  label: string;
  value: unknown;
  onChange: (value: DateFilterValue | undefined) => void;
  presenceLabels?: DatePresenceLabels;
};

export function DateColumnFilter({
  label,
  value,
  onChange,
  presenceLabels,
}: Props) {
  const name = useId();
  const filter = normalizeDateFilter(value, Boolean(presenceLabels));
  const presence = filter?.presence ?? 'all';
  return (
    <div
      className={`dt-filter-date-row${presenceLabels ? ' dt-filter-date-presence' : ''}`}
    >
      <span className="dt-filter-date-label">
        <CalendarDays size={15} />
        {label}
      </span>
      {presenceLabels ? (
        <div
          className="dt-date-presence"
          role="radiogroup"
          aria-label={`Estado de ${label.toLowerCase()}`}
        >
          {(['all', 'present', 'missing'] as const).map((mode) => (
            <label key={mode}>
              <input
                className="dt-sr-only"
                type="radio"
                name={name}
                checked={presence === mode}
                onChange={() =>
                  onChange(
                    normalizeDateFilter(
                      mode === 'all'
                        ? undefined
                        : { ...filter, presence: mode },
                      true,
                    ),
                  )
                }
              />
              <span>{presenceLabels[mode]}</span>
            </label>
          ))}
        </div>
      ) : null}
      {!presenceLabels || presence === 'present' ? (
        <DateRangeFilter
          value={filter?.from ? filter : undefined}
          onChange={(range) =>
            onChange(
              normalizeDateFilter(
                { ...range, presence: filter?.presence },
                Boolean(presenceLabels),
              ),
            )
          }
          placeholder="Elegir fecha"
        />
      ) : null}
    </div>
  );
}
