import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";

// Announce an area that the shell already routes to but no feature slice owns yet.
export function AreaPlaceholder(props: { area: string; arrivesWith: string }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 px-8 py-7">
      <h1 className="font-display text-[36px] leading-tight tracking-tight text-ink">
        {props.area}
      </h1>
      <p className="max-w-[440px] text-[15px] text-body">
        This area arrives with {props.arrivesWith}.
      </p>
    </div>
  );
}

// Announce a route that does not exist and offer the one recovery the shell can perform.
export function NotFoundPlaceholder() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 px-8 py-7">
      <h1 className="font-display text-[36px] leading-tight tracking-tight text-ink">Not found</h1>
      <p className="max-w-[440px] text-[15px] text-body">This route does not exist in XWork.</p>
      <Button className="mt-2" onClick={() => void navigate("/")}>
        Go to Home
      </Button>
    </div>
  );
}
