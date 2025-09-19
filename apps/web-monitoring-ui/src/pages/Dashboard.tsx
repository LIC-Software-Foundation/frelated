import Layout from '../components/Layout';
import { StatCard } from '../components/StatCard';
import { MetricsChart } from '../components/MetricsChart';
import { LogsTable } from '../components/LogsTable';

export default function Dashboard() {
  return (
    <Layout>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <StatCard title="CPU Load" value="72%" trend="up" />
        <StatCard title="Memory Usage" value="5.2 GB" trend="down" />
        <StatCard title="Active Users" value="134" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricsChart />
        <LogsTable />
      </div>
    </Layout>
  );
}
