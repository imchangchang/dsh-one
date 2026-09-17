/** `node --import ./test/legacy-sidebar/register.mjs …`：装上 `vscode` 的解析钩子。 */
import { register } from 'node:module'

register('./vscodeLoader.mjs', import.meta.url)
