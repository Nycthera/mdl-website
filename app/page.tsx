import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MDL — Intro",
  description: "MDL — Introduction and overview of the project and website.",
};

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-12 bg-gradient-to-b from-white to-gray-50 dark:from-[#071013] dark:to-[#061018]">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-extrabold mb-3">MDL</h1>
          <p className="text-gray-700 dark:text-gray-300">MDL is a lightweight toolkit and web interface for managing media download workflows.</p>
          <div className="mt-6 flex items-center justify-center gap-4">
            <a href="/docs/API.md" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">API Docs</a>
            <a href="/download" className="px-4 py-2 border rounded hover:bg-gray-100 dark:hover:bg-gray-800">Downloads</a>
          </div>
        </header>

        <section className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold mb-3">What is MDL?</h2>
            <p className="text-gray-700 dark:text-gray-300">MDL provides a modular backend and frontend for discovering, downloading, and packaging media. The website hosts an API and tools to run background jobs, create archives, and keep track of processed items.</p>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Highlights</h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <li className="p-4 bg-white/60 dark:bg-black/40 rounded shadow-sm">Flexible API-first design — use HTTP to integrate with other tools.</li>
              <li className="p-4 bg-white/60 dark:bg-black/40 rounded shadow-sm">Background job system for long-running tasks with job polling.</li>
              <li className="p-4 bg-white/60 dark:bg-black/40 rounded shadow-sm">CBZ and archive creation utilities to package downloaded content.</li>
              <li className="p-4 bg-white/60 dark:bg-black/40 rounded shadow-sm">Simple tracking store to record processed items and resume workflows.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Who is this for?</h3>
            <p className="text-gray-700 dark:text-gray-300">Developers and hobbyists who need a small, extensible backend for media automation and packaging. For direct download features, visit the dedicated Downloads page.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
