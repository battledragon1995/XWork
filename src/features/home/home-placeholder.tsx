/**
 * The branch shown once at least one project exists. It repeats the copy the shell placeholder
 * used before FE-002 owned this route, so behavior with data is observably unchanged. FE-003
 * replaces this file with the real dashboard without touching the route table.
 */
export function HomePlaceholder() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 px-8 py-7">
      <h1 className="font-display text-[36px] leading-tight tracking-tight text-ink">Home</h1>
      <p className="max-w-[440px] text-[15px] text-body">This area arrives with FE-003.</p>
    </div>
  );
}
