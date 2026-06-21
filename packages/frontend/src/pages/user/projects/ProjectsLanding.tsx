import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTRPC } from "../../../lib/trpc";
import { CreateProjectModal } from "../../../features/project/components/CreateProjectModal";

// Authenticated entry point. Sends you to your first project, or shows a
// create prompt when there are none. Navigation between projects is the sidebar.
export function ProjectsLanding() {
  const trpc = useTRPC();
  const [showCreate, setShowCreate] = useState(false);
  const projectsQuery = useQuery(
    trpc.projects.list.queryOptions({ filter: "all", limit: 1, offset: 0 }),
  );

  if (projectsQuery.isLoading) {
    return <main className="p-8 text-sm text-slate-500">Loading...</main>;
  }

  const first = projectsQuery.data?.[0];
  if (first) return <Navigate to={`/projects/${first.id}`} replace />;

  return (
    <main className="p-8">
      <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
        <p className="text-sm text-slate-500">No projects yet. Create your first one.</p>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          New project
        </button>
      </div>
      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} />
    </main>
  );
}
