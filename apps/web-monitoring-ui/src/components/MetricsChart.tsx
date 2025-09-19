import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const data = [
  { name: '00:00', value: 40 },
  { name: '01:00', value: 30 },
  { name: '02:00', value: 20 },
  { name: '03:00', value: 27 },
];

export function MetricsChart() {
  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <h2 className="font-semibold text-gray-700 mb-2">CPU Usage (%)</h2>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2563eb"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
