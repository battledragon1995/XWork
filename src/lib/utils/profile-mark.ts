/** Keep built-in tool identities aligned with the wireframe without changing stored profiles. */
export function profileMarkColor(profile: { id: string; color: string }): string {
  if (profile.id === "builtin:codex") return "#141413";
  if (profile.id === "builtin:terminal") return "#252320";
  if (profile.id === "builtin:claude") return "#cc785c";
  return profile.color;
}
