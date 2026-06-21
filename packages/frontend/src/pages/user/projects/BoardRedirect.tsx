import { useParams, useSearchParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "../../../lib/trpc";

// Resolves a bare /boards/:boardId link (used by emails + in-app notifications,
// which only carry boardId) to the real /projects/:id/boards/:boardId route,
// preserving ?card= for the card deep-link.
export function BoardRedirect() {
  const trpc = useTRPC();
  const { boardId = "" } = useParams();
  const [params] = useSearchParams();
  const { data, isLoading, isError } = useQuery(
    trpc.boards.get.queryOptions({ id: boardId }),
  );

  if (isLoading) return <div className="p-6 text-muted">Loading...</div>;
  if (isError || !data) return <Navigate to="/projects" replace />;

  const card = params.get("card");
  const suffix = card ? `?card=${card}` : "";
  return (
    <Navigate
      to={`/projects/${data.projectId}/boards/${boardId}${suffix}`}
      replace
    />
  );
}
