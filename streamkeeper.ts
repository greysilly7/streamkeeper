import type { Env } from "./src/types";
import worker from "./src/index";

export { FailoverCoordinator } from "./src/failover";
export default worker satisfies ExportedHandler<Env>;
