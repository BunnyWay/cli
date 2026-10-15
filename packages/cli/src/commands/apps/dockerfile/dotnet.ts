import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

// Read by `dotnet restore`, so copied with the project file to cache it.
const RESTORE_FILES = [
  "global.json",
  "nuget.config",
  "NuGet.config",
  "Directory.Build.props",
  "Directory.Packages.props",
];

export function detectDotnet(project: Project): DetectedApp | undefined {
  // ASP.NET Core apps use the Web SDK; Blazor WebAssembly is a static site.
  const csproj = project.entries
    .filter((e) => e.endsWith(".csproj"))
    .map((file) => ({ file, text: project.read(file) ?? "" }))
    .find(({ text }) => text.includes('Sdk="Microsoft.NET.Sdk.Web"'));
  if (!csproj) return undefined;

  const assembly =
    csproj.text.match(/<AssemblyName>([^<]+)</)?.[1] ??
    csproj.file.replace(/\.csproj$/, "");
  const version = versionFrom(
    [csproj.text, project.read("global.json")],
    /(?:<TargetFrameworks?>[^<]*?net|"version":\s*")(\d+\.\d+)/,
    "10.0",
  );
  const restore = [
    csproj.file,
    ...RESTORE_FILES.filter((f) => project.entries.includes(f)),
  ];

  return {
    label: "ASP.NET Core",
    port: 8080,
    name: assembly.toLowerCase(),
    ignore: ["bin", "obj"],
    dockerfile: (port) =>
      dockerfile("ASP.NET Core", [
        `FROM mcr.microsoft.com/dotnet/sdk:${version} AS build`,
        "WORKDIR /src",
        `COPY ${restore.join(" ")} ./`,
        `RUN dotnet restore ${csproj.file}`,
        "COPY . .",
        `RUN dotnet publish ${csproj.file} -c Release -o /out --no-restore`,
        "",
        `FROM mcr.microsoft.com/dotnet/aspnet:${version}`,
        "WORKDIR /app",
        "COPY --from=build /out ./",
        `ENV ASPNETCORE_URLS=http://+:${port}`,
        `EXPOSE ${port}`,
        `CMD ${JSON.stringify(["dotnet", `${assembly}.dll`])}`,
      ]),
  };
}
