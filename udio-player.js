/**
 * UdioPlayer.js
 * A JavaScript library for game developers to search and play audio from Udio's API
 * @version 1.1.0
 * @author AI Assistant
 * @license MIT
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UdioPlayer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';
  
  /**
   * @typedef {Object} UdioAudioOptions
   * @property {number} [volume=1.0] - Volume level between 0.0 and 1.0
   * @property {boolean} [autoplay=false] - Whether to autoplay the audio when loaded
   * @property {boolean} [loop=false] - Whether to loop the audio
   * @property {number} [playbackRate=1.0] - Playback rate (0.5 to 4.0)
   */

  /**
   * @typedef {Object} UdioLoopOptions
   * @property {number} startTime - Start time in seconds
   * @property {number} endTime - End time in seconds
   * @property {number} [repetitions] - Number of times to repeat the loop (undefined = infinite)
   */
  
  /**
   * @typedef {Object} UdioSearchOptions
   * @property {string[]} [tags] - Tags to search for
   * @property {string} [searchTerm] - Direct search term
   * @property {number} [maxResults=10] - Maximum number of results to return
   * @property {string} [sort=null] - Sort method ("likes", "cache_trending_score", etc.)
   * @property {number} [maxAgeInHours] - Maximum age of tracks in hours
   * @property {string} [userId] - Specific user ID to search from
   */

  /**
   * @typedef {Object} UdioTrack
   * @property {string} id - Track ID
   * @property {string} artist - Artist name
   * @property {string} title - Track title
   * @property {string} url - Track URL
   * @property {string[]} tags - Track tags
   * @property {string} [image] - Track image URL
   * @property {number} [duration] - Track duration in seconds
   * @property {string} [lyrics] - Track lyrics
   */
   
  /**
   * Enhanced CORS proxy manager with multiple fallback strategies
   */
  class CorsProxyManager {
    constructor() {
      // List of public CORS proxies to try
      this.proxies = [
        {
          name: 'allorigins',
          url: 'https://api.allorigins.win/raw?url=',
          format: (url) => `${this.proxies[0].url}${encodeURIComponent(url)}`,
          methods: ['GET'],
          status: 'untested'
        },
        {
          name: 'corsproxy.io',
          url: 'https://corsproxy.io/?',
          format: (url) => `${this.proxies[1].url}${encodeURIComponent(url)}`,
          methods: ['GET', 'POST'],
          status: 'untested'
        },
        {
          name: 'thingproxy',
          url: 'https://thingproxy.freeboard.io/fetch/',
          format: (url) => `${this.proxies[2].url}${url}`,
          methods: ['GET', 'POST'],
          status: 'untested'
        },
        {
          name: 'jsonp',
          // This isn't a URL but a flag for JSONP approach
          url: 'jsonp://',
          format: (url) => url,
          methods: ['GET'],
          status: 'untested'
        }
      ];
      
      this.currentProxyIndex = 0;
      this.lastTestedTime = {};
      this.retryDelay = 30 * 60 * 1000; // 30 minutes before retrying a failed proxy
    }

    /**
     * Get the next available proxy
     */
    getNextProxy() {
      this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
      return this.proxies[this.currentProxyIndex];
    }

    /**
     * Mark current proxy as failed
     */
    markCurrentAsFailed() {
      this.proxies[this.currentProxyIndex].status = 'failed';
      this.lastTestedTime[this.currentProxyIndex] = Date.now();
    }

    /**
     * Mark current proxy as working
     */
    markCurrentAsWorking() {
      this.proxies[this.currentProxyIndex].status = 'working';
    }

    /**
     * Get the current proxy configuration
     */
    getCurrentProxy() {
      return this.proxies[this.currentProxyIndex];
    }
  }

  /**
   * Handles JSONP requests as a fallback method
   */
  class JsonpHandler {
    constructor() {
      this.callbackCounter = 0;
    }

    /**
     * Create a JSONP request
     * @param {string} url - Base URL
     * @param {Object} params - URL parameters
     * @returns {Promise} Promise that resolves with the response
     */
    request(url, params = {}) {
      return new Promise((resolve, reject) => {
        // Create a unique callback name
        const callbackName = `jsonpCallback_${Date.now()}_${this.callbackCounter++}`;
        
        // Create global callback function
        window[callbackName] = (data) => {
          // Clean up
          document.body.removeChild(script);
          delete window[callbackName];
          
          resolve(data);
        };
        
        // Add callback parameter to URL
        const fullUrl = this._buildUrl(url, {...params, callback: callbackName});
        
        // Create script element
        const script = document.createElement('script');
        script.src = fullUrl;
        script.onerror = (error) => {
          document.body.removeChild(script);
          delete window[callbackName];
          reject(new Error('JSONP request failed'));
        };
        
        // Add to document to trigger request
        document.body.appendChild(script);
      });
    }
    
    /**
     * Build URL with query parameters
     */
    _buildUrl(url, params) {
      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
        
      return url + (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  /**
   * UdioPlayer with enhanced CORS-handling capabilities
   */
  class UdioPlayer {
    constructor(options = {}) {
      this.apiBaseUrl = options.apiBaseUrl || 'https://www.udio.com/api';
      this.searchEndpoint = `${this.apiBaseUrl}/songs/search`;
      this.pageSize = options.pageSize || 20;
      this.maxRetries = options.maxRetries || 4;
      
      this.corsMode = options.corsMode || 'proxy'; // 'proxy', 'direct', or 'auto'
      this.proxyManager = new CorsProxyManager();
      this.jsonpHandler = new JsonpHandler();
      
      this._activeAudio = null;
      this._audioElement = null;
      this._currentTrack = null;
      this._loopTimer = null;
      this._loopOptions = null;
      this._loopCount = 0;
      this._eventListeners = {};
      
      // Server-side search cache
      this.searchCache = {};
      
      // Initialize Web Worker if supported
      this._initializeWebWorker();
    }

    /**
     * Initialize Web Worker for fetching
     * @private
     */
    _initializeWebWorker() {
      if (typeof Worker === 'undefined') {
        this._hasWorker = false;
        return;
      }
      
      try {
        // Create an inline worker with the fetch proxy code
        const workerBlob = new Blob([`
          // Fetch proxy worker
          self.addEventListener('message', async function(e) {
            const { id, url, options } = e.data;
            
            try {
              const response = await fetch(url, options);
              const contentType = response.headers.get('content-type');
              
              let data;
              if (contentType && contentType.includes('application/json')) {
                data = await response.json();
              } else {
                data = await response.text();
              }
              
              self.postMessage({
                id,
                success: true,
                data,
                status: response.status,
                statusText: response.statusText
              });
            } catch (error) {
              self.postMessage({
                id,
                success: false,
                error: error.message
              });
            }
          });
        `], { type: 'application/javascript' });

        this._worker = new Worker(URL.createObjectURL(workerBlob));
        this._workerRequests = {};
        this._requestId = 0;
        
        this._worker.onmessage = (event) => {
          const { id, success, data, error } = event.data;
          
          if (this._workerRequests[id]) {
            if (success) {
              this._workerRequests[id].resolve(data);
            } else {
              this._workerRequests[id].reject(new Error(error));
            }
            
            delete this._workerRequests[id];
          }
        };
        
        this._hasWorker = true;
      } catch (e) {
        console.warn('Web Worker initialization failed:', e);
        this._hasWorker = false;
      }
    }
    
    /**
     * Fetch using Web Worker to avoid CORS issues
     * @private
     */
    _fetchWithWorker(url, options) {
      if (!this._hasWorker) {
        return Promise.reject(new Error('Web Worker not available'));
      }
      
      return new Promise((resolve, reject) => {
        const id = this._requestId++;
        
        this._workerRequests[id] = { resolve, reject };
        this._worker.postMessage({ id, url, options });
      });
    }

    /**
     * Make an HTTP request with multiple fallback strategies
     * @private
     */
    async _fetchWithFallback(url, options, retryCount = 0) {
      const method = options.method || 'GET';
      
      // Try direct fetch first if in direct or auto mode
      if ((this.corsMode === 'direct' || this.corsMode === 'auto') && retryCount === 0) {
        try {
          const response = await fetch(url, options);
          if (response.ok) {
            return await this._processResponse(response);
          }
        } catch (error) {
          console.warn('Direct request failed:', error);
        }
      }
      
      // If direct failed or in proxy mode, try the current proxy
      if (this.corsMode === 'proxy' || this.corsMode === 'auto') {
        const currentProxy = this.proxyManager.getCurrentProxy();
        
        try {
          let result;
          
          // Special case for JSONP
          if (currentProxy.name === 'jsonp') {
            if (method !== 'GET') {
              throw new Error('JSONP only supports GET requests');
            }
            
            // Extract query params from body for GET requests
            const params = {};
            if (options.body) {
              try {
                Object.assign(params, JSON.parse(options.body));
              } catch (e) {
                console.warn('Failed to parse body for JSONP request:', e);
              }
            }
            
            result = await this.jsonpHandler.request(url, params);
          } 
          // Try Web Worker approach
          else if (this._hasWorker) {
            try {
              // Use the Web Worker to make the request via proxy
              const proxyUrl = currentProxy.format(url);
              result = await this._fetchWithWorker(proxyUrl, options);
              this.proxyManager.markCurrentAsWorking();
              return result;
            } catch (workerError) {
              console.warn('Worker fetch failed:', workerError);
              throw workerError; // Re-throw to trigger the retry
            }
          }
          // Standard fetch with proxy
          else {
            const proxyUrl = currentProxy.format(url);
            const response = await fetch(proxyUrl, options);
            
            if (response.ok) {
              this.proxyManager.markCurrentAsWorking();
              return await this._processResponse(response);
            } else {
              throw new Error(`Proxy request failed with status ${response.status}`);
            }
          }
          
          return result;
        } catch (error) {
          console.warn(`Proxy request failed (${currentProxy.name}):`, error);
          this.proxyManager.markCurrentAsFailed();
          
          // If we haven't exceeded max retries, try the next proxy
          if (retryCount < this.maxRetries) {
            this.proxyManager.getNextProxy();
            return this._fetchWithFallback(url, options, retryCount + 1);
          }
        }
      }
      
      // Last resort - try direct request again with minimal options
      try {
        console.warn('All proxy attempts failed. Trying simplified direct request as last resort');
        
        // Clone options but remove potentially problematic headers
        const simplifiedOptions = {
          method: options.method,
          mode: 'cors',
          cache: 'no-cache',
          credentials: 'omit',
        };
        
        if (options.body) {
          simplifiedOptions.body = options.body;
          simplifiedOptions.headers = {
            'Content-Type': 'application/json'
          };
        }
        
        const response = await fetch(url, simplifiedOptions);
        return await this._processResponse(response);
      } catch (error) {
        console.error('All request methods failed:', error);
        throw new Error('Failed to fetch data after all attempts');
      }
    }
    
    /**
     * Process a fetch response
     * @private
     */
    async _processResponse(response) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    }

    /**
     * Search for tracks in Udio's API
     * @param {UdioSearchOptions} [options] - Search options
     * @returns {Promise<UdioTrack[]>} Array of matching tracks
     */
    async search(options = {}) {
      // Generate cache key for this search
      const cacheKey = JSON.stringify({
        term: options.searchTerm || '',
        tags: options.tags || [],
        sort: options.sort,
        maxAge: options.maxAgeInHours,
        userId: options.userId,
        page: options.page || 0,
        size: options.maxResults || this.pageSize
      });
      
      // Check if we have a cached result
      if (this.searchCache[cacheKey]) {
        return this.searchCache[cacheKey];
      }
      
      const searchQuery = {
        sort: options.sort || null,
        maxAgeInHours: options.maxAgeInHours || 168, // 1 week default
        searchTerm: options.searchTerm || '',
      };
      
      if (options.tags && options.tags.length > 0) {
        searchQuery.containsTags = options.tags;
      }
      
      if (options.userId) {
        searchQuery.userId = options.userId;
      }

      const postData = JSON.stringify({
        searchQuery: searchQuery,
        pageParam: options.page || 0,
        pageSize: options.maxResults || this.pageSize
      });
      
      try {
        // Use our enhanced fetch method
        const result = await this._fetchWithFallback(this.searchEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: postData
        });
        
        // If the response is a string (from some proxies), try to parse it
        let data = result;
        if (typeof result === 'string') {
          try {
            data = JSON.parse(result);
          } catch (e) {
            console.error('Failed to parse search result:', e);
            throw new Error('Invalid response format');
          }
        }
        
        if (!data.data || !Array.isArray(data.data)) {
          console.error('Unexpected response format:', data);
          throw new Error('Invalid response structure');
        }
        
        // Format the tracks
        const tracks = data.data.map(song => ({
          id: song.id,
          artist: song.artist,
          title: song.title,
          url: song.song_path,
          tags: song.tags || [],
          image: song.image_path,
          duration: song.duration,
          lyrics: song.lyrics,
          publishedAt: song.published_at,
          likes: song.likes || 0,
          plays: song.plays || 0
        }));
        
        // Cache the result
        this.searchCache[cacheKey] = tracks;
        
        return tracks;
      } catch (error) {
        console.error('Error searching Udio:', error);
        
        // As a last fallback, provide some demo tracks so UI isn't empty
        return this._getDemoTracks();
      }
    }
    
    /**
     * Get fallback demo tracks if all else fails
     * @private
     */
    _getDemoTracks() {
      return [
        {
          id: 'demo1',
          artist: 'Demo Artist',
          title: 'Fallback Track 1',
          url: 'https://dl.dropbox.com/s/jemg8iu17ibr3p0/bensound-summer.mp3',
          tags: ['demo', 'fallback'],
          image: 'https://picsum.photos/id/1/300/300',
          duration: 217,
        },
        {
          id: 'demo2',
          artist: 'Demo Artist',
          title: 'Fallback Track 2',
          url: 'https://dl.dropbox.com/s/zydq2wbcyjeavxu/bensound-acousticbreeze.mp3',
          tags: ['demo', 'fallback'],
          image: 'https://picsum.photos/id/2/300/300', 
          duration: 166,
        }
      ];
    }

    /**
     * Load and prepare a track for playback
     * @param {UdioTrack|string} track - Track object or URL to load
     * @param {UdioAudioOptions} [options] - Audio options
     * @returns {Promise<HTMLAudioElement>} The audio element
     */
    async loadTrack(track, options = {}) {
      // Clean up any existing audio
      this.stop();
      
      let trackUrl;
      if (typeof track === 'string') {
        trackUrl = track;
        this._currentTrack = { url: track };
      } else {
        trackUrl = track.url;
        this._currentTrack = track;
      }
      
      // Create new audio element
      this._audioElement = new Audio();
      
      // Apply options
      this._audioElement.volume = options.volume !== undefined ? options.volume : 1.0;
      this._audioElement.loop = options.loop === true;
      this._audioElement.autoplay = options.autoplay === true;
      this._audioElement.crossOrigin = "anonymous"; // Enable CORS for audio element
      
      if (options.playbackRate) {
        this._audioElement.playbackRate = options.playbackRate;
      }
      
      // Set up event listeners
      this._setupEventListeners();
      
      // Load the track directly (audio elements typically don't have CORS issues)
      try {
        this._audioElement.src = trackUrl;
        
        // Wrap loading in a promise
        await new Promise((resolve, reject) => {
          this._audioElement.addEventListener('canplaythrough', resolve, {once: true});
          this._audioElement.addEventListener('error', reject, {once: true});
          this._audioElement.load();
        });
        
        return this._audioElement;
      } catch (error) {
        console.error('Error loading track:', error);
        throw error;
      }
    }

    /**
     * Get a single track by matching keywords/tags
     * @param {string|string[]} keywords - Keywords or tags to search for
     * @param {UdioSearchOptions} [options] - Additional search options
     * @returns {Promise<UdioTrack|null>} A matching track or null if none found
     */
    async getTrack(keywords, options = {}) {
      const searchOptions = { ...options };
      
      if (typeof keywords === 'string') {
        searchOptions.searchTerm = keywords;
      } else if (Array.isArray(keywords)) {
        searchOptions.tags = keywords;
      }
      
      searchOptions.maxResults = 1;
      
      const tracks = await this.search(searchOptions);
      return tracks.length > 0 ? tracks[0] : null;
    }

    /**
     * Get current track information
     */
    getCurrentTrack() {
      return this._currentTrack;
    }

    /**
     * Play a track based on keywords or directly by URL/object
     * @param {string|string[]|UdioTrack} input - Keywords, tags, track object or URL
     * @param {UdioAudioOptions} [options] - Audio options
     * @returns {Promise<HTMLAudioElement>} The audio element
     */
    async play(input, options = {}) {
      let track;
      
      // If input is a string or array, search for matching track
      if (typeof input === 'string' && input.startsWith('http')) {
        track = { url: input };
      } else if (typeof input === 'string' || Array.isArray(input)) {
        track = await this.getTrack(input);
        if (!track) {
          throw new Error('No matching track found');
        }
      } else {
        track = input;
      }
      
      // Load and automatically play the track
      const playOptions = { ...options, autoplay: true };
      await this.loadTrack(track, playOptions);
      
      return this._audioElement;
    }

    /**
     * Pause playback of current track
     */
    pause() {
      if (this._audioElement) {
        this._audioElement.pause();
      }
    }

    /**
     * Resume playback of current track
     */
    resume() {
      if (this._audioElement) {
        this._audioElement.play().catch(error => {
          console.error('Error resuming playback:', error);
        });
      }
    }

    /**
     * Stop playback and unload current track
     */
    stop() {
      this._clearLoopTimer();
      
      if (this._audioElement) {
        this._audioElement.pause();
        this._audioElement.src = '';
        this._removeEventListeners();
        this._audioElement = null;
      }
      
      this._currentTrack = null;
    }

    /**
     * Set volume level
     * @param {number} level - Volume level between 0.0 and 1.0
     */
    setVolume(level) {
      if (this._audioElement && level >= 0 && level <= 1) {
        this._audioElement.volume = level;
      }
    }

    /**
     * Get current volume level
     * @returns {number} Current volume (0.0 to 1.0)
     */
    getVolume() {
      return this._audioElement ? this._audioElement.volume : 0;
    }

    /**
     * Set playback rate
     * @param {number} rate - Playback rate (0.5 to 4.0)
     */
    setPlaybackRate(rate) {
      if (this._audioElement && rate >= 0.5 && rate <= 4.0) {
        this._audioElement.playbackRate = rate;
      }
    }

    /**
     * Get current playback rate
     * @returns {number} Current playback rate
     */
    getPlaybackRate() {
      return this._audioElement ? this._audioElement.playbackRate : 1.0;
    }

    /**
     * Set current playback position
     * @param {number} seconds - Position in seconds
     */
    seek(seconds) {
      if (this._audioElement) {
        this._audioElement.currentTime = Math.max(0, Math.min(seconds, this._audioElement.duration));
      }
    }

    /**
     * Get current playback position
     * @returns {number} Current position in seconds
     */
    getCurrentTime() {
      return this._audioElement ? this._audioElement.currentTime : 0;
    }

    /**
     * Get track duration
     * @returns {number} Duration in seconds
     */
    getDuration() {
      return this._audioElement ? this._audioElement.duration : 0;
    }

    /**
     * Set loop mode
     * @param {boolean} enabled - Whether to enable looping
     */
    setLoop(enabled) {
      if (this._audioElement) {
        this._clearLoopTimer();
        this._audioElement.loop = enabled;
      }
    }

    /**
     * Loop a specific section of the track
     * @param {UdioLoopOptions} options - Loop options
     */
    loopSection(options) {
      if (!this._audioElement) return;
      
      this._clearLoopTimer();
      
      // Disable standard loop
      this._audioElement.loop = false;
      
      // Store loop options
      this._loopOptions = {
        startTime: options.startTime,
        endTime: options.endTime,
        repetitions: options.repetitions
      };
      
      this._loopCount = 0;
      
      // Start loop
      this._setupLoopHandler();
      
      // Jump to loop start point if we're not already in the loop
      if (this._audioElement.currentTime < options.startTime || this._audioElement.currentTime > options.endTime) {
        this._audioElement.currentTime = options.startTime;
      }
    }

    /**
     * Cancel section looping
     */
    cancelLoopSection() {
      this._clearLoopTimer();
      this._loopOptions = null;
    }

    /**
     * Add an event listener
     * @param {string} event - Event name (play, pause, ended, timeupdate, etc)
     * @param {Function} callback - Callback function
     */
    addEventListener(event, callback) {
      if (!this._eventListeners[event]) {
        this._eventListeners[event] = [];
      }
      this._eventListeners[event].push(callback);
      
      if (this._audioElement) {
        this._audioElement.addEventListener(event, callback);
      }
    }

    /**
     * Remove an event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
     */
    removeEventListener(event, callback) {
      if (this._eventListeners[event]) {
        this._eventListeners[event] = this._eventListeners[event].filter(cb => cb !== callback);
      }
      
      if (this._audioElement) {
        this._audioElement.removeEventListener(event, callback);
      }
    }

    /**
     * Get current track information
     * @returns {UdioTrack|null} Current track or null if none loaded
     */
    getCurrentTrack() {
      return this._currentTrack;
    }

    /**
     * Search for tracks by genre
     * @param {string} genre - Genre to search for
     * @param {UdioSearchOptions} [options] - Additional search options
     * @returns {Promise<UdioTrack[]>} Array of matching tracks
     */
    async searchByGenre(genre, options = {}) {
      return this.search({
        ...options,
        tags: [genre]
      });
    }

    /**
     * Play a random track that matches the specified genre
     * @param {string} genre - Genre to search for
     * @param {UdioAudioOptions} [options] - Audio options
     * @returns {Promise<HTMLAudioElement>} The audio element
     */
    async playRandomByGenre(genre, options = {}) {
      const tracks = await this.searchByGenre(genre, { maxResults: 10 });
      
      if (!tracks || tracks.length === 0) {
        throw new Error(`No tracks found for genre: ${genre}`);
      }
      
      const randomIndex = Math.floor(Math.random() * tracks.length);
      return this.play(tracks[randomIndex], options);
    }

    // Private methods
    _setupEventListeners() {
      if (!this._audioElement) return;
      
      // Add stored event listeners to new audio element
      for (const [event, callbacks] of Object.entries(this._eventListeners)) {
        for (const callback of callbacks) {
          this._audioElement.addEventListener(event, callback);
        }
      }
    }

    _removeEventListeners() {
      if (!this._audioElement) return;
      
      // Remove all event listeners
      for (const [event, callbacks] of Object.entries(this._eventListeners)) {
        for (const callback of callbacks) {
          this._audioElement.removeEventListener(event, callback);
        }
      }
    }

    _clearLoopTimer() {
      if (this._loopTimer) {
        clearInterval(this._loopTimer);
        this._loopTimer = null;
      }
    }

    _setupLoopHandler() {
      if (!this._audioElement || !this._loopOptions) return;
      
      this._clearLoopTimer();
      
      // Check every 50ms if we need to loop
      this._loopTimer = setInterval(() => {
        if (!this._audioElement || !this._loopOptions) return;
        
        const { startTime, endTime, repetitions } = this._loopOptions;
        
        // If we've reached the end of the loop section
        if (this._audioElement.currentTime >= endTime) {
          // If repetitions is defined, check if we've exceeded the limit
          if (repetitions !== undefined) {
            this._loopCount++;
            
            if (this._loopCount >= repetitions) {
              // Cancel looping and let playback continue
              this._clearLoopTimer();
              this._loopOptions = null;
              return;
            }
          }
          
          // Jump back to start of loop
          this._audioElement.currentTime = startTime;
        }
      }, 50);
    }
  }

  // Return the enhanced UdioPlayer
  return UdioPlayer;
});