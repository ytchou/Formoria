import { createNavigation } from 'next-intl/navigation'

import { routing } from './routing'

const { Link, usePathname, useRouter } = createNavigation(routing)
export { Link, usePathname, useRouter }
