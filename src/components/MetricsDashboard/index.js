import { usePluginData } from '@docusaurus/useGlobalData';
import metricsData from '@site/data/metrics.json';
import { formatDate } from '../shared/formatDate';
import styles from './styles.module.css';

const BUILD_CLOCK = 'build-clock';
const DAY_MS = 86400000;

// Horizontal position within the 20..500 plot area of the 520x220 viewBox. A
// lone sample has no span to spread across, so it sits at the midpoint rather
// than on the left edge -- the centring Sparkline already applies to its own
// single-sample case -- and the length-1 denominator is never zero.
function pointX(index, length) {
  return length <= 1 ? 260 : 20 + (index / (length - 1)) * 480;
}
function pointY(value, values) {
  const max = Math.max(...values.map((point) => point.value), 1);
  return 190 - (value / max) * 160;
}
function linePoints(values) {
  return values
    .map(
      (point, index) =>
        `${pointX(index, values.length)},${pointY(point.value, values)}`,
    )
    .join(' ');
}

function Sparkline({ values = [] }) {
  if (!values.length)
    return <span className={styles.noTrend}>No trend data yet</span>;
  const max = Math.max(...values.map((point) => point.value), 1);
  const points = values
    .map(
      (point, index) =>
        `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${24 - (point.value / max) * 20}`,
    )
    .join(' ');
  return (
    <svg
      className={styles.sparkline}
      viewBox="0 0 100 24"
      role="img"
      aria-label={`Trend from ${values[0].date} to ${values.at(-1).date}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Card units are published as plain English plurals ("days"), so a median of
// exactly one would read "1 days". Only an exact 1 takes the singular: 0 and
// a fraction such as 0.5 are plural in English, and a unit that is not an
// "-s" plural is left alone.
function cardUnit(value, suffix) {
  if (!suffix) return '';
  return value === 1 && suffix.endsWith('s') ? suffix.slice(0, -1) : suffix;
}

// A card that publishes `since` is an elapsed time measured from that
// instant; the collector leaves the count out so the data file only changes
// when the queue does. The count is taken against the build clock rather
// than Date.now(): the server-rendered HTML and the hydrating client then
// agree, and the value is as fresh as the last deploy. Whole days, never
// negative: a submission opened after the build is a clock skew, not a
// negative age.
export function cardValue(card, builtAt) {
  if (card.since === undefined) return card.value;
  return Math.max(
    0,
    Math.round((Date.parse(builtAt) - Date.parse(card.since)) / DAY_MS),
  );
}

function LifecycleSection() {
  const lifecycle = metricsData.referenceArchitectureLifecycle;
  const { builtAt } = usePluginData(BUILD_CLOCK);
  return (
    <section className={styles.lifecycle} aria-labelledby="lifecycle-title">
      <div className={styles.chartHeader}>
        <h2 id="lifecycle-title">Reference architecture lifecycle</h2>
        <a href={lifecycle?.sourceUrl} target="_blank" rel="noreferrer">
          Source ↗
        </a>
      </div>
      <p className={styles.chartNote}>
        Leading indicators from public TAB issues and architecture pull
        requests. These are proxies for workflow flow, not exact acceptance or
        validation times.
      </p>
      <div className={styles.lifecycleGrid}>
        {(lifecycle?.cards || []).map((card) => {
          const value = cardValue(card, builtAt);
          return (
            <div className={styles.lifecycleCard} key={card.id}>
              <span>{card.label}</span>
              <strong>
                {card.sampleSize === 0 ? (
                  <span className={styles.noTrend}>No data yet</span>
                ) : (
                  `${value.toLocaleString()} ${cardUnit(value, card.suffix)}`
                )}
              </strong>
              <small>{card.note}</small>
            </div>
          );
        })}
      </div>
      <div className={styles.trendGrid}>
        {Object.entries(lifecycle?.trends || {}).map(([id, trend]) => (
          <div className={styles.trend} key={id}>
            <span>{trend.label}</span>
            <Sparkline values={trend.values} />
          </div>
        ))}
      </div>
      <details className={styles.lifecycleDetails}>
        <summary>What is not yet measurable</summary>
        {(lifecycle?.omitted || []).map((item) => (
          <p key={item.id}>
            <strong>{item.id}:</strong> {item.reason}
          </p>
        ))}
      </details>
    </section>
  );
}

export default function MetricsDashboard() {
  const updated = formatDate(metricsData.generatedAt);
  return (
    <>
      {updated && (
        <div className={styles.meta}>
          Last updated {updated} · collected from public CNCF repositories
        </div>
      )}
      <LifecycleSection />
      <div className={styles.grid}>
        {metricsData.metrics.map((metric) => (
          <a
            className={styles.card}
            href={metric.sourceUrl}
            key={metric.id}
            target="_blank"
            rel="noreferrer"
          >
            <span className={styles.label}>{metric.label}</span>
            <strong>{metric.value.toLocaleString()}</strong>
            <span className={styles.note}>{metric.note}</span>
            <span className={styles.source}>Source: {metric.source} ↗</span>
          </a>
        ))}
      </div>
      <div className={styles.lineCharts}>
        {Object.entries(metricsData.series || {}).map(([id, series]) => (
          <section
            className={styles.lineChart}
            key={id}
            aria-labelledby={`${id}-title`}
          >
            <div className={styles.chartHeader}>
              <h2 id={`${id}-title`}>{series.label}</h2>
              <a href={series.sourceUrl} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            </div>
            <svg
              className={styles.svg}
              viewBox="0 0 520 220"
              role="img"
              aria-label={`${series.label} over time`}
            >
              <polyline
                points={linePoints(series.values)}
                fill="none"
                stroke="var(--ifm-color-primary)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              {series.values.map((point, index) => (
                <circle
                  key={`${point.date}-${index}`}
                  cx={pointX(index, series.values.length)}
                  cy={pointY(point.value, series.values)}
                  r="4"
                  fill="var(--ifm-color-primary)"
                >
                  <title>{`${point.date}: ${point.value}`}</title>
                </circle>
              ))}
            </svg>
            <div className={styles.chartRange}>
              <span>{series.values[0]?.date}</span>
              <strong>{series.values.at(-1)?.value.toLocaleString()}</strong>
              <span>{series.values.at(-1)?.date}</span>
            </div>
            <p className={styles.chartNote}>
              Collected from {series.source}; values show the published snapshot
              available at build time.
            </p>
          </section>
        ))}
      </div>
      <div className={styles.charts}>
        {Object.entries(metricsData.breakdowns || {}).map(([id, chart]) => (
          <section
            className={styles.chart}
            key={id}
            aria-labelledby={`${id}-title`}
          >
            <div className={styles.chartHeader}>
              <h2 id={`${id}-title`}>{chart.label}</h2>
              <a href={chart.sourceUrl} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            </div>
            <div className={styles.bars} role="list">
              {chart.values.map((item) => (
                <div className={styles.barRow} role="listitem" key={item.name}>
                  <span className={styles.barLabel}>{item.name}</span>
                  <div className={styles.track}>
                    <span
                      className={styles.bar}
                      style={{
                        '--bar-width': `${(item.value / chart.values[0].value) * 100}%`,
                      }}
                    />
                  </div>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className={styles.transparency}>
        <strong>Data coverage</strong>
        <p>
          Values unavailable from authoritative sources are omitted rather than
          estimated. See the source links on each metric for collection details.
        </p>
        {metricsData.omitted.map((item) => (
          <span key={item.id}>
            {item.id}: {item.reason}
          </span>
        ))}
      </div>
    </>
  );
}
