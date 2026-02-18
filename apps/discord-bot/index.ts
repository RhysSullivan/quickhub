import { program } from "./src/bot";
import { createAppLayer, runMain } from "./src/core/runtime";

const AppLayer = createAppLayer();

runMain(program, AppLayer);
