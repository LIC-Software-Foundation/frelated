export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-gray-100 flex flex-col">
        <div className="p-4 text-lg font-bold border-b border-gray-700">
          Monitoring Dashboard
        </div>
        <nav className="flex-1 p-2 space-y-2">
          <a href="#" className="block p-2 rounded hover:bg-gray-700">
            Overview
          </a>
          <a href="#" className="block p-2 rounded hover:bg-gray-700">
            Metrics
          </a>
          <a href="#" className="block p-2 rounded hover:bg-gray-700">
            Logs
          </a>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
