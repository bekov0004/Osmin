import {Module} from '../module.js';
import {ArtworkService} from './artworkService.js';

/**
 * Album covers: turns an MPRIS `mpris:artUrl` into a local file (downloading http(s) ones once into
 * the cache) and finds a vivid colour of the picture. Nothing to mirror: only calls.
 * rpc_resolve({url}) -> {path, color}
 */
export class ArtworkModule extends Module {
    constructor() {
        super('Artwork');
        this._artwork = new ArtworkService();
    }

    stop() {
        this._artwork.destroy();
    }

    async rpc_resolve({url}) {
        const file = await this._artwork.resolve(String(url ?? ''));
        if (!file)
            return {path: null, color: null};
        return {path: file.get_path(), color: this._artwork.dominantColor(file)};
    }
}
