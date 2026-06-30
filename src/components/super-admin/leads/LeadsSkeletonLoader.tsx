export default function LeadsSkeletonLoader() {
  return (
    <div className="space-y-8 p-6 animate-pulse">
      <div className="flex justify-between items-center">
        <div className="h-8 w-48 bg-slate-200 rounded"></div>
        <div className="h-10 w-32 bg-slate-200 rounded"></div>
      </div>

      <div className="space-y-4">
        <div className="h-6 w-32 bg-slate-200 rounded"></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 w-full bg-slate-100 rounded"></div>
          ))}
        </div>
      </div>

      <div className="h-px bg-slate-200 w-full"></div>

      <div className="space-y-4">
        <div className="h-6 w-48 bg-slate-200 rounded"></div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 w-full bg-slate-100 rounded"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
