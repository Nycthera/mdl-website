import StartDownloadForm from "../components/StartDownloadForm";
import JobsPanel from "../components/JobsPanel";

export const metadata = {
  title: "MDL — Downloads",
  description: "Start downloads and monitor jobs.",
};

export default function DownloadPage() {
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold">Downloads</h1>
          <p className="text-gray-600">Start a download job and monitor progress.</p>
        </header>

        <section className="mb-8 bg-white/60 dark:bg-black/40 p-4 rounded">
          <StartDownloadForm />
        </section>

        <section className="bg-white/60 dark:bg-black/40 p-4 rounded">
          <h2 className="text-lg font-semibold mb-3">Jobs</h2>
          <JobsPanel />
        </section>
      </div>
    </main>
  );
}
