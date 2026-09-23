import React from 'react';
import metricsData from '@site/data/metrics.json';
import styles from './styles.module.css';

function pointX(index, length) {
  return length <= 1 ? 20 : 20 + (index / (length - 1)) * 480;
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

function LifecycleSection() {
  const lifecycle = metricsData.referenceArchitectureLifecycle;
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
        {(lifecycle?.cards || []).map((card) => (
          <div className={styles.lifecycleCard} key={card.id}>
            <span>{card.label}</span>
            <strong>
              {card.value.toLocaleString()} {card.suffix || ''}
            </strong>
            <small>{card.note}</small>
          </div>
        ))}
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
  const updated = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(metricsData.generatedAt));
  return (
    <>
      <div className={styles.meta}>
        Last updated {updated} UTC · collected from public CNCF repositories
      </div>
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
                  <title>
                    {point.date}: {point.value}
                  </title>
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
