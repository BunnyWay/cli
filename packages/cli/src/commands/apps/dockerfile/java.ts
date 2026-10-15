import {
  type DetectedApp,
  dockerfile,
  type Project,
  versionFrom,
} from "./project.ts";

export function detectJava(project: Project): DetectedApp | undefined {
  const has = (file: string) => project.entries.includes(file);
  const pom = project.read("pom.xml");
  const gradle =
    project.read("build.gradle.kts") ?? project.read("build.gradle");
  const build = pom ?? gradle;
  // Spring Boot packages a self-contained, runnable jar.
  if (!build?.includes("org.springframework.boot")) return undefined;

  const jdk = versionFrom(
    [build],
    /(?:<java\.version>|JavaLanguageVersion\.of\(|sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?)(\d{2})/,
    "21",
  );
  // Use the project's wrapper when it has one, so the build tool version
  // matches; otherwise the build image provides Maven or Gradle. `sh` runs
  // the wrapper even when a Windows checkout lost its executable bit.
  const [image, command] = pom
    ? has("mvnw")
      ? [`eclipse-temurin:${jdk}-jdk`, "sh mvnw"]
      : [`maven:3-eclipse-temurin-${jdk}`, "mvn"]
    : has("gradlew")
      ? [`eclipse-temurin:${jdk}-jdk`, "sh gradlew"]
      : [`gradle:jdk${jdk}`, "gradle"];
  // Gradle also writes a `-plain.jar` without dependencies; skip it.
  const jar = pom
    ? `${command} -B -DskipTests package && cp target/*.jar /app.jar`
    : `${command} bootJar -x test --no-daemon && cp $(ls build/libs/*.jar | grep -v -- -plain.jar) /app.jar`;

  return {
    label: "Spring Boot",
    port: 8080,
    ignore: ["target", "build", ".gradle"],
    dockerfile: (port) =>
      dockerfile("Spring Boot", [
        `FROM ${image} AS build`,
        "WORKDIR /src",
        "COPY . .",
        `RUN ${jar}`,
        "",
        `FROM eclipse-temurin:${jdk}-jre`,
        "COPY --from=build /app.jar /app.jar",
        `ENV SERVER_PORT=${port}`,
        `EXPOSE ${port}`,
        'CMD ["java", "-jar", "/app.jar"]',
      ]),
  };
}
