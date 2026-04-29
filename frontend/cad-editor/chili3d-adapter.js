(function () {
  class Chili3DAdapter {
    constructor(options = {}) {
      this.mount = options.mount || null;
      this.log = options.log || (() => {});
      this.runtime = null;
    }

    isAvailable() {
      return Boolean(this._runtimeCandidate());
    }

    async loadFile(blob, metadata = {}) {
      const runtime = this._runtimeCandidate();
      if (!runtime) {
        return {
          ok: false,
          reason: 'Chili3D runtime is not bundled in this SaaS build.',
        };
      }

      this.runtime = await this._createRuntime(runtime);
      const file = new File([blob], metadata.filename || 'model.cad', {
        type: blob.type || 'application/octet-stream',
      });

      const loader = this._resolveLoader(this.runtime);
      if (!loader) {
        return {
          ok: false,
          reason: 'Chili3D runtime was found, but no compatible file loader API was exposed.',
        };
      }

      await loader(file, metadata);
      return { ok: true };
    }

    async _createRuntime(runtime) {
      if (runtime?.createWorkspace) {
        return runtime.createWorkspace({ container: this.mount });
      }
      if (runtime?.create) {
        return runtime.create({ container: this.mount });
      }
      if (runtime?.Workspace) {
        return new runtime.Workspace({ container: this.mount });
      }
      return runtime;
    }

    _resolveLoader(runtime) {
      const candidates = [
        [runtime, runtime?.openFile],
        [runtime, runtime?.importFile],
        [runtime, runtime?.loadFile],
        [runtime?.document, runtime?.document?.openFile],
        [runtime?.document, runtime?.document?.importFile],
      ].filter((entry) => typeof entry[1] === 'function');

      if (!candidates.length) return null;
      return async (file, metadata) => {
        this.log(`Loading ${metadata.filename || file.name} through Chili3D adapter`);
        const [context, loader] = candidates[0];
        await loader.call(context, file, metadata);
      };
    }

    _runtimeCandidate() {
      return window.Chili3D || window.chili3d || window.Chili3d || null;
    }
  }

  window.ProfileAxisChili3DAdapter = Chili3DAdapter;
})();
