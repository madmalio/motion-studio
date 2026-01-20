export namespace main {
	
	export class Project {
	    id: string;
	    name: string;
	    type: string;
	    thumbnail: string;
	    updatedAt: string;
	
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
	    }
	}
	export class Scene {
	    id: string;
	    projectId: string;
	    name: string;
	    shotCount: number;
	    updatedAt: string;
	
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
	    }
	}
	export class Shot {
	    id: string;
	    sceneId: string;
	    name: string;
	    sourceImage: string;
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
	        this.prompt = source["prompt"];
	        this.motionStrength = source["motionStrength"];
	        this.seed = source["seed"];
	        this.duration = source["duration"];
	        this.status = source["status"];
	        this.outputVideo = source["outputVideo"];
	    }
	}

}

