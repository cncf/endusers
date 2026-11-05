import data from '@site/data/survey-reports.json';
import ReportList from '../shared/ReportList';

export default function SurveyReports() {
  return (
    <ReportList
      data={data}
      listKey="surveyReports"
      ariaLabel="CNCF survey reports"
    />
  );
}
