import qs from 'qs'
//import {setSessionStorage,getSessionStorage} from '@/utils/storage,js'

function errMsg(code){
	if(code==401){
		return '认证失败，无法访问系统资源';
	}else if(code==403){
		return '当前操作没有权限';
	}else if(code==404){
		return '访问资源不存在';
	}else{
		return '系统未知错误，请反馈给管理员';
	}
}

let isRelogin = {show: false}


const handleAuthorized = (vm) => {
    if (!isRelogin.show) {
        // 如果已经到重新登录页面则不进行弹窗提示
        if (window.location.href.includes('login')) {
            return
        }
        isRelogin.show = true

		uni.showModal({
			title:'系统提示',
			content:'登录超时,请重新登录!',
			success:function(res){
				if(res.confirm){
					vm.$u.api.logout().then((res)=>{
						if(res.code == 200){
							//console.log(res)
							vm.$store.commit('resetStore');
					
							setTimeout(()=>{
								uni.reLaunch({
									url:"/pages/sys/login/index"
								})
							},500)
						}
					})
				}
			}
		})
    }
    return Promise.reject("登录超时,请重新登录!")
}

const refreshToken = async (vm) => {
	return await vm.$u.api.refreshToken({
		refreshToken:vm.vuex_ref_token
	})
}

const ignoreMsgs = [
    '无效的刷新令牌',
    '刷新令牌已过期'
]

// 请求队列
let requestList = []
// 是否正在刷新中(无感知刷新令牌)
let isRefreshToken = false
// 请求白名单，无须token的接口
const whiteList = ['/login', '/refreshToken']
	
//401处理代码
const handle401 = async (vm,config,flag)=>{
	// 如果未认证，并且未进行刷新令牌，说明可能是访问令牌过期
	if (!isRefreshToken) {
		isRefreshToken = true
		// 1. 如果获取不到刷新令牌，则只能执行登出操作
		if (!vm.vuex_ref_token) {
			return handleAuthorized(vm)
		}
	
		try {
			const response = await refreshToken(vm)
			//console.log(response);
			if (response.data.token !=null && response.data.token) {
				//console.log(response.data.token)
				vm.$u.vuex('vuex_token', response.data.token.accessToken);
				vm.$u.vuex('vuex_ref_token', response.data.token.refreshToken);
				if (config.header) {
					config.header.Authorization = 'Bearer ' + vm.vuex_token
				}
				requestList.forEach((req) => {
					req()
				})
				requestList = []
				
				if(flag==1){
					return vm.$u.uploadFileRef(config);
				}else{
					return vm.$u.http.request(config);
				}
			} else {
				return handleAuthorized(vm)
			}
		} catch (e) {
			console.log("error",e)
			requestList.forEach((req) => {
				req()
			})
			return handleAuthorized(vm)
		} finally {
			requestList = []
			isRefreshToken = false
		}
	} else {
		return new Promise((resolve) => {
			requestList.push(() => {
				if (config.header) {
					config.header.Authorization = 'Bearer ' + vm.vuex_token
				}
				if(flag==1){
					console.log("调用2")
					uni.uploadFile({
						...config,
						success: (res) => {
							let resp = JSON.parse(res.data)
							resolve(resp)
						}
					})
				}else{
					resolve(vm.$u.http.request(config))
				}
			})
		})
	}
	
	return Promise.reject('无效的会话，或者会话已过期，请重新登录。')
}
	
// 此处第二个参数vm，就是我们在页面使用的this，你可以通过vm获取vuex等操作
const install = (Vue, vm) => {
	// 参数配置对象
	const conf = vm.vuex_config;
	
	Vue.prototype.$u.http.interceptors.request.use((config) => {
		config.baseURL = conf.baseUrl;
		
		console.log(config)
		if(!config.header || !config.header['Content-Type']){
			config.header = {
				'Content-Type':'application/json'
			}
		}
		
		config.timeout= 10 * 60 * 1000;
		
		//console.log(config.header)
		
		let isToken = (config.header || {}).isToken === false;
		//console.log(isToken)
		whiteList.some((item) => {
			if (config.url) {
				if (config.url.indexOf(item) > -1) {
					return (isToken = false);
				}
			}
		})

		//是否需要防止重复提交
		const isRepeatSubmit = false;
		if(config.header && config.header.repeatSubmit){
			isRepeatSubmit = config.header.repeatSubmit === false;
		}

		if (vm.vuex_token && !isToken) {
			config.header['Authorization'] = "Bearer " + vm.vuex_token;
		}

		//请求参数
		const params = config.params || {};
		//提交参数
		const data = config.data || false;
		
		//console.log(config)

		//POST参数处理
		if (config.method?.toUpperCase() === 'POST' && config.header && 
			config.header['Content-Type'] === 'application/x-www-form-urlencoded') {
			config.data = qs.stringify(data);
		}
		//GET参数处理
		if (config.method?.toUpperCase() === 'GET' && params) {
			config.params = {};
			const paramsStr = qs.stringify(params, {
				allowDots: true
			});
			if (paramsStr) {
				config.url = config.url + '?' + paramsStr;
			}
		}

		/*
		//重复提交验证
		if (!isRepeatSubmit && (config.method?.toUpperCase() === 'POST' || config.method?.toUpperCase() ==='PUT')) {
			//请求对象
			const requestObj = {
				url: config.url,
				data: typeof config.data === 'object' ? JSON.stringify(config.data) : config.data, 
				time: new Date().getTime() //请求提交时间
			}
			// 请求数据大小
			const requestSize = Object.keys(JSON.stringify(requestObj)).length;
			// 限制存放数据5M
			const limitSize = 5 * 1024 * 1024;
			if (requestSize >= limitSize) {
				console.warn(`[${config.url}]: ` + '请求数据大小超出允许的5M限制，无法进行防重复提交验证。')
				return config;
			}

			//在会话级缓存中查看requestObj对象是否存在,不存在则将当前请求信息写入
			const sessionObj = cache.session.getJSON('requestObj')
			if (sessionObj === undefined || sessionObj === null || sessionObj === '') {
				cache.session.setJSON('requestObj', requestObj)
			} else {
				//已经存在相同的请求则根据时间来判断是否为重复提交，是则拒绝提交
				const s_url = sessionObj.url; // 请求地址
				const s_data = sessionObj.data; // 请求数据
				const s_time = sessionObj.time; // 请求时间
				const interval = 1000; // 间隔时间(ms)，小于此时间视为重复提交
				if (s_data === requestObj.data && requestObj.time - s_time < interval && s_url === requestObj.url) {
					const message = '数据正在处理，请勿重复提交';
					console.warn(`[${s_url}]: ` + message)
					return Promise.reject(new Error(message))
				} else {
					//不同请求则重新设置请求信息
					cache.session.setJSON('requestObj', requestObj)
				}
			}
		}
		
		*/
		
		return config;
	}, err => {
		console.log("错误请求信息", err);
		Promise.reject(err);
	})


	// 响应拦截器
	Vue.prototype.$u.http.interceptors.response.use(async res => {
			// 二进制数据则直接返回数据
			if(res.request){
				if (res.request.responseType === 'blob' || res.request.responseType === 'arraybuffer') {
					// 注意：如果导出的响应为 json，说明可能失败了，不直接返回进行下载
					if (res.data.type !== 'application/json') {
						return res.data
					}
				}
			}
			
			const config = res.config

			const code2 = res.statusCode || 200;

			// 未设置状态码则默认成功状态
			const code = res.data.code || 200;
 
			// 获取错误信息
			const msg = errMsg[code] || res.data.msg || errMsg['default']

			if (ignoreMsgs.indexOf(msg) !== -1) {
				// 如果是忽略的错误码，直接返回 msg 异常
				return Promise.reject(msg)
			} else if (code === 401) {
				if(config.flag==1){
					return await handle401(vm,config)
				}else{
					return handle401(vm,config)
				}
				
			} else if (code === 500) {
				uni.showToast({title:"系统内部错误:"+msg,icon:'error'})
				return Promise.reject(msg)
			} else if (code === 601) {
				uni.showToast({title:msg,icon:'error'})
				return Promise.reject('error')
			} else if (code !== 200) {
				uni.showToast({title:msg,icon:'error'})
				return Promise.reject('error')
			} else {
				return res.data
			}
		},
		error => {
			console.log('err' + error)
			let {
				message
			} = error;
			if (message == "Network Error") {
				message = "后端接口连接异常";
			} else if (message.includes("timeout")) {
				message = "系统接口请求超时";
			} else if (message.includes("Request failed with status code")) {
				message = "系统接口" + message.substr(message.length - 3) + "异常";
			}
			return Promise.reject(error)
		})


	// 封装 get text 请求
	vm.$u.getText = (url, data = {}, header = {}) => {
		url = conf.adminPath + url;
		return vm.$u.http.request({
			dataType: 'text',
			method: 'GET',
			url,
			header,
			data
		})
	}

	// 封装 get text 请求
	vm.$u.getJson = (url, data = {}, header = {}) => {
		url = conf.adminPath + url;
		return vm.$u.http.request({
			//dataType: 'text',
			method: 'GET',
			url,
			header,
			data
		})
	}

	// 封装 post json 请求
	vm.$u.postJson = (url, data = {}, header = {}) => {
		url = conf.adminPath + url;
		header['content-type'] = 'application/json';
		return vm.$u.http.request({
			url,
			method: 'POST',
			header,
			data
		})
	}
	
	vm.$u.uploadFileRef = (configTmp)=> {
		return new Promise((resolve, reject) => {
			uni.uploadFile({
				...configTmp,
				success: (res) => {
					let resp = JSON.parse(res.data)
					resolve(resp)
				}
			})
		})
	}
	
	vm.$u.uploadFile = (url,filePath,formData)=> {
		let configTmp = {
			header:{
				'Authorization':"Bearer " + vm.vuex_token
			},
			url: conf.baseUrl+url,
			filePath: filePath,
			name: 'file',
			formData: formData,
		}
		return new Promise((resolve, reject) => {
			let result = uni.uploadFile({
				...configTmp,
				success: (res) => {
					console.log(res)
					if(res.statusCode==200){
						let resp = JSON.parse(res.data)
						const code = resp.code || 200;
						if(code==401){
							resolve(handle401(vm,configTmp,1))
						}else{
							resolve(resp)
						}

					}else{
						reject(res)
					}
				}
			});
		})
	}
	
	vm.$u.postUpload = (url,params,filePath)=>{
		const formData = new FormData(); // 创建FormData对象
		formData.append('file', filePath); // 将文件添加到表单数据中
	 
		url = conf.adminPath+url;
		

		return vm.$u.http.request({
			url: url,
			//dataType:'json',
			//method:'POST',
			//async: false,
			//data: formData,
			processData : false, // 使数据不做处理
			//contentType : false, // 不要设置Content-Type请求头
			//headers: { 'Content-Type': false },
			header:{
				'Content-Type':'multipart/form-data',
				//'Content-Type':'application/x-www-form-urlencoded',
				//'Authorization':"Bearer " + vm.vuex_token
			},
			method:'POST',
			data:{
				'file':filePath
			}, 
		})
		//config.header['Content-Type'] === 'application/x-www-form-urlencoded') {
		//config.data = qs.stringify(data);
			
			
			/*
		url = conf.adminPath+url;
		//url = conf.adminPath+'/common/upload';
		return vm.$u.http.request({
			url: url, // 仅为示例，非真实的接口地址
			//filePath: filePath,
			header:{
				'Content-Type':'multipart/form-data',
				//'Authorization':"Bearer " + vm.vuex_token
			},
			method:'POST',
			name: 'file',
			data: {
				file:filePath
			},
		})
		*/
	}

}

export default {
	install
}