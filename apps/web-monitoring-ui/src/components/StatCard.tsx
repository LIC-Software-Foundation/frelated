type StatCardProps = {
  title: string;
  value: string | number;
  trend?: 'up' | 'down';
};

export function StatCard({ title, value, trend }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow p-4 flex flex-col">
      <span className="text-gray-500 text-sm">{title}</span>
      <span className="text-2xl font-bold mt-1">{value}</span>
      {trend && (
        <span
          className={`text-sm mt-1 ${
            trend === 'up' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {trend === 'up' ? '▲ Increasing' : '▼ Decreasing'}
        </span>
      )}
    </div>
  );
}
