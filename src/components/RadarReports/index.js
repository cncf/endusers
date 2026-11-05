import data from '@site/data/radar-reports.json';
import ReportList from '../shared/ReportList';

export default function RadarReports() {
  return (
    <ReportList
      data={data}
      listKey="radarReports"
      ariaLabel="CNCF Technology Radar reports"
    />
  );
}
