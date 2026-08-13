import { BindingStore } from './binding-store'
import { MessageRouter, type MessageRouterDeps } from './router'
import type { IncomingMessage } from './types'
/** Small compositional gateway: adapters deliver input to this router; registry retains lifecycle ownership. */
export class MessagingGateway { readonly router: MessageRouter; constructor(bindings: BindingStore, deps: Omit<MessageRouterDeps, 'bindingStore'>) { this.router = new MessageRouter({ ...deps, bindingStore: bindings }) } async onIncoming(message: IncomingMessage): Promise<boolean> { return this.router.route(message) } }
