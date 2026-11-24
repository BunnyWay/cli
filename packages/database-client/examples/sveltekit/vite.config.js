import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";

export default { plugins: [sveltekit({ adapter: adapter() })] };
