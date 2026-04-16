const LOADING_STEPS = [
  { label: "Connecting to database" },
  { label: "Fetching tables" },
  { label: "Preparing studio" },
];

export function LoadingScreen({ error }: { error: string | null }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-[400px]">
        <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/50">
          Database Studio
        </p>

        <h1 className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
          {error ? "Connection Failed" : "Setting Up"}
        </h1>

        {!error && (
          <div className="mb-8 h-[2px] w-full overflow-hidden rounded-full bg-border">
            <div className="sweep-bar h-full w-[30%] rounded-full bg-primary" />
          </div>
        )}

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="mb-10 space-y-2.5">
            {LOADING_STEPS.map((step, i) => (
              <div
                key={i}
                className="step-reveal flex items-baseline gap-3"
                style={{ animationDelay: `${0.3 + i * 0.8}s` }}
              >
                <span className="w-4 shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
