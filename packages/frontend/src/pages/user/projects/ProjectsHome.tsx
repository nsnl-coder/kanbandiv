// Signed-in landing. Project/board navigation lives in the left sidebar, so this
// is just a lightweight home shown at "/" and "/projects".
export function ProjectsHome() {
  return (
    <main className="flex min-h-[60vh] w-full items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-foreground">Welcome</h1>
        <p className="mt-2 text-sm text-muted">
          Pick a board from the sidebar, or create one to get started.
        </p>
      </div>
    </main>
  );
}
