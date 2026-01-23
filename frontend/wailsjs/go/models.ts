export namespace main {
	
	export class Project {
	    id: string;
	    name: string;
	    type: string;
	    thumbnail: string;
	    updatedAt: string;
	    sceneCount: number;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.thumbnail = source["thumbnail"];
	        this.updatedAt = source["updatedAt"];
	        this.sceneCount = source["sceneCount"];
	    }
	}
	export class Scene {
	    id: string;
	    projectId: string;
	    name: string;
	    shotCount: number;
	    updatedAt: string;
	    thumbnail: string;
	
	    static createFrom(source: any = {}) {
	        return new Scene(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.name = source["name"];
	        this.shotCount = source["shotCount"];
	        this.updatedAt = source["updatedAt"];
	        this.thumbnail = source["thumbnail"];
	    }
	}
	export class Shot {
	    id: string;
	    sceneId: string;
	    name: string;
	    sourceImage: string;
	    audioPath: string;
	    audioStart: number;
	    audioDuration: number;
	    prompt: string;
	    motionStrength: number;
	    seed: number;
	    duration: number;
	    status: string;
	    outputVideo: string;
	
	    static createFrom(source: any = {}) {
	        return new Shot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sceneId = source["sceneId"];
	        this.name = source["name"];
	        this.sourceImage = source["sourceImage"];
	        this.audioPath = source["audioPath"];
	        this.audioStart = source["audioStart"];
	        this.audioDuration = source["audioDuration"];
	        this.prompt = source["prompt"];
	        this.motionStrength = source["motionStrength"];
	        this.seed = source["seed"];
	        this.duration = source["duration"];
	        this.status = source["status"];
	        this.outputVideo = source["outputVideo"];
	    }
	}
	export class TrackSetting {
	    locked: boolean;
	    visible: boolean;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new TrackSetting(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.locked = source["locked"];
	        this.visible = source["visible"];
	        this.name = source["name"];
	    }
	}
	export class TimelineData {
	    tracks: any[][];
	    trackSettings: TrackSetting[];
	
	    static createFrom(source: any = {}) {
	        return new TimelineData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tracks = source["tracks"];
	        this.trackSettings = this.convertValues(source["trackSettings"], TrackSetting);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Workflow {
	    id: string;
	    name: string;
	    hasAudio: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Workflow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.hasAudio = source["hasAudio"];
	    }
	}

}

