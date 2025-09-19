export function LogsTable() {
  const logs = [
    { time: '12:01:22', level: 'INFO', message: 'Server started' },
    { time: '12:02:10', level: 'WARN', message: 'High CPU usage' },
    { time: '12:03:05', level: 'ERROR', message: 'DB connection lost' },
  ];

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <h2 className="font-semibold text-gray-700 mb-2">Recent Logs</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="p-2">Time</th>
            <th className="p-2">Level</th>
            <th className="p-2">Message</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => (
            <tr key={i} className="border-t">
              <td className="p-2 text-gray-600">{log.time}</td>
              <td
                className={`p-2 font-semibold ${
                  log.level === 'ERROR'
                    ? 'text-red-600'
                    : log.level === 'WARN'
                      ? 'text-yellow-600'
                      : 'text-green-600'
                }`}
              >
                {log.level}
              </td>
              <td className="p-2">{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
