import { InMemoryTenantResolver } from '../tenant';

describe('Tenant Service', () => {
  describe('InMemoryTenantResolver', () => {
    const resolver = new InMemoryTenantResolver();

    it('returns tenant for known phone number', async () => {
      const tenant = await resolver.resolveTenant('+1234567890');

      expect(tenant).not.toBeNull();
      expect(tenant?.id).toBeDefined();
      expect(tenant?.name).toBeDefined();
      expect(tenant?.phoneNumber).toBe('+1234567890');
    });

    it('returns null for unknown phone number', async () => {
      const tenant = await resolver.resolveTenant('+9999999999');

      expect(tenant).toBeNull();
    });
  });
});
