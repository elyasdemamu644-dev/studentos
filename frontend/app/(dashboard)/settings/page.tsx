import dynamicImport from "next/dynamic";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function SettingsLoading() {
  return (
    <div className="space-y-8">
      <div className="surface-panel p-6">
        <div className="h-8 w-1/3 animate-pulse bg-muted" />
        <div className="mt-3 h-4 w-1/4 animate-pulse bg-muted" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-panel p-5">
          <div className="h-5 w-32 animate-pulse bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-14 rounded-lg animate-pulse bg-muted" />
            <div className="h-14 rounded-lg animate-pulse bg-muted" />
          </div>
        </div>
        <div className="surface-panel p-5 lg:col-span-2">
          <div className="h-5 w-40 animate-pulse bg-muted" />
          <div className="mt-4 flex items-center gap-4">
            <div className="h-24 w-24 rounded-full animate-pulse bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse bg-muted" />
              <div className="h-3 w-1/2 animate-pulse bg-muted" />
              <div className="h-3 w-2/3 animate-pulse bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SettingsClient = dynamicImport(
  () => import("./SettingsClient").then((mod) => mod.default),
  {
    ssr: false,
    loading: SettingsLoading,
  },
);

export default function SettingsPage() {
  return <SettingsClient />;
}